"""Deterministic contracts, without stock allocation or financial commands."""

import base64
import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from rentalops_api.auth import Identity
from rentalops_api.catalog_models import ProductPhoto
from rentalops_api.catalog_storage import (
    CONTENT_TYPES,
    CatalogError,
    PhotoStorage,
    StoredPhoto,
    normalize_image,
)
from rentalops_api.contract_contracts import (
    CompanyCommand,
    CompanyFields,
    ContractCommand,
    ContractIssue,
    ContractPreview,
    ContractSnapshot,
    DeliveryCommand,
    ImageSnapshot,
    ItemSnapshot,
    LogoCommand,
    SignatureCommand,
    SignatureValidation,
)
from rentalops_api.contract_models import (
    CompanyRevision,
    CompanySettings,
    ContractEvent,
    ContractRequest,
    ContractSeries,
    ContractVersion,
)
from rentalops_api.contract_pdf import render_pdf
from rentalops_api.customer_contracts import Address
from rentalops_api.customer_models import Customer
from rentalops_api.database import session_scope
from rentalops_api.payment_errors import PaymentError, conflict, invalid
from rentalops_api.payment_models import PaymentAccount
from rentalops_api.payment_storage import (
    MAX_PROOF_BYTES,
    ProofStorage,
    StoredProof,
    validate_proof,
)
from rentalops_api.payments import PaymentService
from rentalops_api.quotation_contracts import SAO_PAULO
from rentalops_api.quotation_models import Quotation, QuotationVersion
from rentalops_api.rental_effects import rental_for_quotation

TEMPLATE_REVISION = "pegue-e-monte-v0.4"
TEMPLATE_DIGEST = "c036ecf76d780e5a2068867710d3d089aa62d5e7c1d42e2dab0fb059145731f0"


def template() -> str:
    content = Path(__file__).with_name("contract_template_v04.md").read_bytes()
    if hashlib.sha256(content).hexdigest() != TEMPLATE_DIGEST:
        raise PaymentError(503, "template_unavailable", "Modelo aprovado indisponível.")
    return content.decode("utf-8").replace("\r\n", "\n")


def address_pending(address: Address) -> list[str]:
    return [
        key
        for key in ("street", "number", "neighborhood", "city", "state", "postal_code")
        if not getattr(address, key)
    ]


def company_pending(company: CompanyFields) -> list[str]:
    return [
        key
        for key in ("name", "identification", "contact")
        if not getattr(company, key)
    ] + [f"address.{key}" for key in address_pending(company.address)]


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def differences(
    previous: dict[str, object] | None, current: dict[str, object]
) -> list[dict[str, object]]:
    ignored = {"number", "issued_at"}
    if previous is None:
        return []

    # Frozen images are identified by digest in the semantic diff, not raw bytes.
    def sanitized(value: object) -> object:
        if isinstance(value, dict):
            return {
                key: sanitized(item)
                for key, item in value.items()
                if key not in {"content", "storage_key", "key"}
            }
        if isinstance(value, list):
            return [sanitized(item) for item in value]
        return value

    return [
        {
            "field": key,
            "before": sanitized(previous.get(key)),
            "after": sanitized(current[key]),
        }
        for key in sorted(current)
        if key not in ignored and previous.get(key) != current[key]
    ]


class ContractService:
    def __init__(
        self,
        factory: sessionmaker[Session],
        photos: PhotoStorage | None = None,
        documents: ProofStorage | None = None,
        clock: Callable[[], datetime] | None = None,
        renderer: Callable[..., bytes] = render_pdf,
    ) -> None:
        self.factory = factory
        self.photos = photos or PhotoStorage.from_environment()
        self.documents = documents or ProofStorage(self.photos.root)
        self.clock = clock or (lambda: datetime.now(UTC))
        self.renderer = renderer
        self.payments = PaymentService(factory, self.documents, self.clock)

    def _request(
        self,
        session: Session,
        operation: str,
        payload: CompanyCommand | LogoCommand | ContractIssue | ContractCommand,
        actor: Identity,
        digest: str,
    ) -> dict[str, object] | None:
        request_id = payload.request_id
        key = int.from_bytes(
            hashlib.sha256(
                f"contract:{actor.user_id}:{operation}:{request_id}".encode()
            ).digest()[:8],
            "big",
            signed=True,
        )
        session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
        previous = session.get(ContractRequest, (actor.user_id, operation, request_id))
        if previous:
            if previous.payload_hash != digest:
                raise conflict("idempotency_conflict")
            return previous.result
        return None

    def _save_request(
        self,
        session: Session,
        operation: str,
        payload: CompanyCommand | LogoCommand | ContractIssue | ContractCommand,
        actor: Identity,
        digest: str,
        result: dict[str, object],
    ) -> None:
        session.add(
            ContractRequest(
                actor_id=actor.user_id,
                operation=operation,
                request_id=payload.request_id,
                payload_hash=digest,
                result=result,
            )
        )
        session.commit()

    def _company(
        self, session: Session, *, locked: bool = False
    ) -> CompanySettings | None:
        query = select(CompanySettings).where(CompanySettings.id == 1)
        return session.scalar(query.with_for_update(read=True) if locked else query)

    def _company_view(self, session: Session) -> dict[str, object]:
        row = self._company(session)
        fields = CompanyFields.model_validate(row.data if row else {})
        return {
            "version": row.version if row else 0,
            **fields.model_dump(mode="json"),
            "logo": {key: value for key, value in row.logo.items() if key != "key"}
            if row and row.logo
            else None,
            "pending": company_pending(fields),
        }

    def company(self) -> dict[str, object]:
        with session_scope(self.factory) as session:
            return self._company_view(session)

    def update_company(
        self,
        payload: CompanyCommand | LogoCommand,
        actor: Identity,
        upload: tuple[bytes, str | None] | None = None,
    ) -> dict[str, object]:
        normalized = normalize_image(*upload) if upload else None
        if isinstance(payload, LogoCommand) and not payload.remove and not normalized:
            raise invalid("Selecione uma imagem para a logo.")
        if isinstance(payload, LogoCommand) and payload.remove and upload:
            raise invalid("Escolha enviar ou remover a logo.")
        operation = (
            "company_logo" if isinstance(payload, LogoCommand) else "company_fields"
        )
        digest = canonical_hash(
            {
                "payload": payload.model_dump(mode="json"),
                "upload": hashlib.sha256(upload[0]).hexdigest() if upload else None,
                "type": upload[1] if upload else None,
            }
        )
        stored: StoredPhoto | None = None
        try:
            with session_scope(self.factory) as session:
                replay = self._request(session, operation, payload, actor, digest)
                if replay is not None:
                    return replay
                # Independent settings serialization; never locks business records.
                session.execute(text("SELECT pg_advisory_xact_lock(150001)"))
                row = self._company(session)
                if (row.version if row else 0) != payload.expected_version:
                    raise conflict()
                if row is None:
                    row = CompanySettings(
                        id=1,
                        version=0,
                        data=CompanyFields().model_dump(mode="json"),
                        logo=None,
                    )
                    session.add(row)
                before = row.data
                if isinstance(payload, CompanyCommand):
                    row.data = payload.model_dump(
                        mode="json", exclude={"request_id", "expected_version"}
                    )
                    changed = [
                        key for key in row.data if row.data[key] != before.get(key)
                    ]
                else:
                    changed = ["logo"]
                    if normalized:
                        stored = self.photos.write(*normalized)
                        row.logo = {
                            "id": uuid4().hex,
                            "key": stored.key,
                            "size": stored.size,
                            "sha256": stored.sha256,
                            "format": stored.image_format,
                        }
                    else:
                        row.logo = None
                row.version += 1
                session.add(
                    CompanyRevision(
                        version=row.version,
                        data=row.data,
                        logo=row.logo,
                        actor_id=actor.user_id,
                        session_id=actor.session_id,
                        changed_fields=changed,
                        created_at=self.clock(),
                    )
                )
                session.flush()
                result = self._company_view(session)
                self._save_request(session, operation, payload, actor, digest, result)
                return result
        except BaseException:
            if stored:
                self._compensate_photo(stored.key)
            raise

    def _compensate_photo(self, key: str) -> None:
        try:
            with session_scope(self.factory) as session:
                session.execute(text("SELECT pg_advisory_xact_lock(150001)"))
                revisions = session.scalars(select(CompanyRevision))
                if not any(
                    row.logo and row.logo.get("key") == key for row in revisions
                ):
                    self.photos.compensate(key)
        except Exception:
            return

    def company_logo(self) -> tuple[bytes, str]:
        with session_scope(self.factory) as session:
            company = self._company(session)
            if company is None or not company.logo:
                raise PaymentError(404, "not_found", "Logo não cadastrada.")
            asset = company.logo
        return self.photos.read(
            str(asset["key"]), int(str(asset["size"])), str(asset["sha256"])
        ), CONTENT_TYPES[str(asset["format"])]

    def _business(
        self,
        session: Session,
        identifier: UUID,
        payload: ContractPreview,
        *,
        locked: bool = False,
    ) -> tuple[
        Quotation, QuotationVersion, int, dict[str, object], ContractSeries | None
    ]:
        header, offer = self.payments._quotation(session, identifier, write=locked)
        rental = rental_for_quotation(session, identifier, locked=locked)
        financial = self.payments.confirmation_summary(
            session, header, offer, locked=locked
        )
        query = select(ContractSeries).where(ContractSeries.quotation_id == identifier)
        series = session.scalar(
            query.with_for_update().execution_options(populate_existing=True)
            if locked
            else query
        )
        actual = (
            header.current_version,
            financial["financial_version"],
            rental.version if rental else 0,
            series.current_version if series else 0,
        )
        expected = (
            payload.expected_quotation_version,
            payload.expected_financial_version,
            payload.expected_rental_version,
            payload.expected_contract_version,
        )
        if actual != expected:
            raise conflict()
        return header, offer, rental.version if rental else 0, financial, series

    def _image(self, identifier: UUID, asset: dict[str, object]) -> ImageSnapshot:
        data = self.photos.read(
            str(asset["key"]), int(str(asset["size"])), str(asset["sha256"])
        )
        # Validate decode too: a correct digest alone cannot prove a usable photo.
        content_type = CONTENT_TYPES[str(asset["format"])]
        normalize_image(data, content_type)
        return ImageSnapshot(
            id=identifier,
            sha256=hashlib.sha256(data).hexdigest(),
            content_type=content_type,
            storage_key=str(asset["key"]),
            content=base64.b64encode(data).decode(),
        )

    def capture(
        self, identifier: UUID, payload: ContractPreview
    ) -> tuple[ContractSnapshot, list[dict[str, str]], list[dict[str, object]]]:
        assets: dict[UUID, dict[str, object]] = {}
        pending: list[dict[str, str]] = []

        def missing(field: str, label: str) -> None:
            pending.append({"field": field, "message": label})

        with session_scope(self.factory) as session:
            header, offer, rental_version, financial, series = self._business(
                session, identifier, payload
            )
            company = self._company(session)
            if (company.version if company else 0) != payload.expected_company_version:
                raise conflict()
            fields = CompanyFields.model_validate(company.data if company else {})
            for field in company_pending(fields):
                missing(
                    f"company.{field}", "Complete os dados da locadora em Parâmetros."
                )
            customer = session.get(Customer, header.customer_id)
            assert customer is not None
            if not customer.cpf:
                missing("customer.cpf", "Complete o CPF no cadastro do cliente.")
            if len(customer.name.split()) < 2:
                missing("customer.name", "Complete o nome do cliente.")
            customer_address = Address.model_validate(customer.address or {})
            for field in address_pending(customer_address):
                missing(f"customer.address.{field}", "Complete o endereço do cliente.")
            for field in address_pending(payload.event_address):
                missing(f"event_address.{field}", "Complete o endereço do evento.")
            demand: dict[UUID, tuple[str, int]] = {}
            for line in cast(list[dict[str, object]], offer.snapshot["lines"]):
                for item in cast(list[dict[str, object]], line["items"]):
                    pid = UUID(str(item["product_id"]))
                    old = demand.get(pid, (str(item["name"]), 0))
                    demand[pid] = (
                        old[0],
                        old[1]
                        + int(str(item["quantity"])) * int(str(line["quantity"])),
                    )
            inputs = {item.product_id: item for item in payload.items}
            if set(inputs) - set(demand):
                raise invalid(
                    "Condições/fotos devem pertencer aos produtos desta versão."
                )
            items: list[ItemSnapshot] = []
            for pid, (name, quantity) in sorted(demand.items()):
                entry = inputs.get(pid)
                condition = entry.condition if entry else None
                query = select(ProductPhoto).where(
                    ProductPhoto.product_id == pid, ProductPhoto.is_attached.is_(True)
                )
                if entry and entry.photo_id:
                    query = query.where(ProductPhoto.id == entry.photo_id)
                photo = session.scalar(
                    query.order_by(
                        ProductPhoto.is_principal.desc(),
                        ProductPhoto.position,
                        ProductPhoto.id,
                    ).limit(1)
                )
                if not photo:
                    missing(
                        f"items.{pid}.photo",
                        f"Foto do produto {name} pendente no catálogo.",
                    )
                else:
                    assets[pid] = {
                        "id": photo.id,
                        "key": photo.storage_key,
                        "format": photo.format,
                        "size": photo.size,
                        "sha256": photo.sha256,
                    }
                items.append(
                    ItemSnapshot(
                        product_id=pid,
                        name=name,
                        quantity=quantity,
                        condition=condition,
                        photo=None,
                    )
                )
            number = (series.current_version if series else 0) + 1
            previous = (
                session.get(ContractVersion, (series.id, series.current_version))
                if series and series.current_version
                else None
            )
            previous_snapshot = previous.snapshot if previous else None
            logo = dict(company.logo) if company and company.logo else None
            snapshot = ContractSnapshot(
                quotation_id=identifier,
                quotation_version=header.current_version,
                financial_version=cast(int, financial["financial_version"]),
                rental_version=rental_version,
                company_version=company.version if company else 0,
                customer_version=customer.version,
                template_revision=TEMPLATE_REVISION,
                template_digest=TEMPLATE_DIGEST,
                template_text=template(),
                number=number,
                issued_at=self.clock().isoformat(),
                company=fields,
                logo=None,
                customer_name=customer.name,
                customer_cpf=customer.cpf,
                customer_rg=customer.rg,
                customer_phone=customer.phone,
                customer_address=customer_address,
                event_address=payload.event_address,
                pickup_date=offer.pickup_date.isoformat(),
                event_date=offer.event_date.isoformat(),
                return_date=offer.return_date.isoformat(),
                pickup_time=cast(str | None, offer.snapshot.get("pickup_time")),
                return_time=cast(str | None, offer.snapshot.get("return_time")),
                total=str(financial["total"]),
                deposit=str(financial["estimated_deposit"]),
                balance=str(financial["estimated_balance"]),
                received=str(financial["net_received"]),
                remaining=str(financial["remaining"]),
                commercial=offer.snapshot,
                financial=financial,
                items=items,
            )
        # No transaction/row lock while reading or decoding image bytes/rendering.
        if sum(int(str(asset["size"])) for asset in assets.values()) > 100_000_000:
            raise invalid(
                "Imagens excedem a capacidade de composição. "
                "Use fotos menores no catálogo."
            )
        for snapshot_item in snapshot.items:
            if snapshot_item.product_id in assets:
                asset = assets[snapshot_item.product_id]
                try:
                    snapshot_item.photo = self._image(cast(UUID, asset["id"]), asset)
                except CatalogError:
                    missing(
                        f"items.{snapshot_item.product_id}.photo",
                        f"Foto de {snapshot_item.name} ilegível ou indisponível.",
                    )
        if logo:
            try:
                snapshot.logo = self._image(UUID(str(logo["id"])), logo)
            except CatalogError:
                missing(
                    "company.logo",
                    "Logo cadastrada ilegível; substitua ou remova em Parâmetros.",
                )
        return (
            snapshot,
            pending,
            differences(previous_snapshot, snapshot.model_dump(mode="json")),
        )

    def preview(self, identifier: UUID, payload: ContractPreview) -> dict[str, object]:
        snapshot, pending, diff = self.capture(identifier, payload)
        data = self._render(snapshot, draft=True)
        return {
            "pending": pending,
            "differences": diff,
            "number": snapshot.number,
            "document": base64.b64encode(data).decode(),
            "sha256": hashlib.sha256(data).hexdigest(),
            "state": "draft",
        }

    def _render(self, snapshot: ContractSnapshot, *, draft: bool) -> bytes:
        try:
            content = self.renderer(snapshot, draft=draft)
            if not content or len(content) > MAX_PROOF_BYTES:
                raise ValueError
            return content
        except Exception:
            raise PaymentError(
                503,
                "renderer_unavailable",
                "Não foi possível compor o PDF completo. Nenhum contrato foi emitido.",
            ) from None

    def issue(
        self, identifier: UUID, payload: ContractIssue, actor: Identity
    ) -> dict[str, object]:
        operation = f"issue:{identifier}"
        digest = canonical_hash(payload.model_dump(mode="json"))
        with session_scope(self.factory) as session:
            replay = self._request(session, operation, payload, actor, digest)
            if replay is not None:
                return replay
        snapshot, pending, diff = self.capture(identifier, payload)
        if pending:
            raise invalid(
                "Complete as pendências da prévia antes de emitir o contrato final."
            )
        data = self._render(snapshot, draft=False)
        stored: StoredProof | None = None
        try:
            with session_scope(self.factory) as session:
                replay = self._request(session, operation, payload, actor, digest)
                if replay is not None:
                    return replay
                header, _, _, _, series = self._business(
                    session, identifier, payload, locked=True
                )
                company = self._company(session, locked=True)
                customer = session.scalar(
                    select(Customer)
                    .where(Customer.id == header.customer_id)
                    .with_for_update(read=True)
                )
                if (
                    company is None
                    or company.version != snapshot.company_version
                    or customer is None
                    or customer.version != snapshot.customer_version
                ):
                    raise conflict()
                # Metadata may detach concurrently; captured bytes are frozen and
                # referenced source files are immutable. No reverse catalog lock.
                if series is None:
                    series = ContractSeries(
                        id=uuid4(), quotation_id=identifier, current_version=0
                    )
                    session.add(series)
                    session.flush()
                series.current_version += 1
                stored = self.documents.write(data, "application/pdf")
                version = ContractVersion(
                    series_id=series.id,
                    number=series.current_version,
                    quotation_id=identifier,
                    quotation_version=snapshot.quotation_version,
                    financial_version=snapshot.financial_version,
                    rental_version=snapshot.rental_version,
                    company_version=snapshot.company_version,
                    template_revision=TEMPLATE_REVISION,
                    template_digest=TEMPLATE_DIGEST,
                    snapshot=snapshot.model_dump(mode="json"),
                    differences=diff,
                    storage_key=stored.key,
                    pdf_size=stored.size,
                    pdf_sha256=stored.sha256,
                    state="issued",
                    actor_id=actor.user_id,
                    session_id=actor.session_id,
                    created_at=datetime.fromisoformat(snapshot.issued_at),
                )
                session.add(version)
                session.flush()
                result = self._version(session, series, version)
                self._save_request(session, operation, payload, actor, digest, result)
                return result
        except BaseException:
            if stored:
                self._compensate_document(identifier, stored.key)
            raise

    def _series(
        self, session: Session, identifier: UUID, *, locked: bool = False
    ) -> ContractSeries:
        query = select(ContractSeries).where(ContractSeries.id == identifier)
        series = session.scalar(
            query.with_for_update().execution_options(populate_existing=True)
            if locked
            else query
        )
        if series is None:
            raise PaymentError(404, "not_found", "Contrato não encontrado.")
        return series

    def _events(
        self, session: Session, series: ContractSeries, number: int
    ) -> list[ContractEvent]:
        return list(
            session.scalars(
                select(ContractEvent)
                .where(
                    ContractEvent.series_id == series.id, ContractEvent.number == number
                )
                .order_by(ContractEvent.position)
            )
        )

    def _version(
        self, session: Session, series: ContractSeries, row: ContractVersion
    ) -> dict[str, object]:
        events = self._events(session, series, row.number)
        uploads = [event for event in events if event.kind == "signature_upload"]
        latest = uploads[-1] if uploads else None
        signed = bool(
            latest
            and any(
                event.kind == "signature_validation"
                and event.data["attachment_id"] == str(latest.id)
                for event in events
            )
        )
        return {
            "contract_id": str(series.id),
            "quotation_id": str(series.quotation_id),
            "number": row.number,
            "current_version": series.current_version,
            "quotation_version": row.quotation_version,
            "financial_version": row.financial_version,
            "rental_version": row.rental_version,
            "company_version": row.company_version,
            "template_revision": row.template_revision,
            "template_digest": row.template_digest,
            "pdf_sha256": row.pdf_sha256,
            "state": row.state,
            "delivered": any(event.kind == "delivery" for event in events),
            "signature_state": "signed"
            if signed
            else "awaiting_review"
            if uploads
            else "pending",
            "differences": row.differences,
            "actor_id": str(row.actor_id),
            "created_at": row.created_at.isoformat(),
            "events": [
                {
                    "id": str(event.id),
                    "kind": event.kind,
                    "data": event.data,
                    "actor_id": str(event.actor_id),
                    "created_at": event.created_at.isoformat(),
                }
                for event in events
            ],
        }

    def versions(
        self, identifier: UUID, *, quotation: bool = False
    ) -> list[dict[str, object]]:
        with session_scope(self.factory) as session:
            if quotation:
                self.payments._quotation(session, identifier)
                series = session.scalar(
                    select(ContractSeries).where(
                        ContractSeries.quotation_id == identifier
                    )
                )
                if series is None:
                    return []
            else:
                series = self._series(session, identifier)
            return [
                self._version(session, series, row)
                for row in session.scalars(
                    select(ContractVersion)
                    .where(ContractVersion.series_id == series.id)
                    .order_by(ContractVersion.number.desc())
                )
            ]

    def version(self, identifier: UUID, number: int) -> dict[str, object]:
        with session_scope(self.factory) as session:
            series = self._series(session, identifier)
            row = session.get(ContractVersion, (identifier, number))
            if row is None:
                raise PaymentError(404, "not_found", "Versão não encontrada.")
            return self._version(session, series, row)

    def signature_state(self, quotation_id: UUID) -> dict[str, object]:
        with session_scope(self.factory) as session:
            header, _ = self.payments._quotation(session, quotation_id)
            rental = rental_for_quotation(session, quotation_id)
            series = session.scalar(
                select(ContractSeries).where(
                    ContractSeries.quotation_id == quotation_id
                )
            )
            row = (
                session.get(ContractVersion, (series.id, series.current_version))
                if series
                else None
            )
            view = self._version(session, series, row) if series and row else None
            matches = bool(
                row
                and row.quotation_version == header.current_version
                and row.rental_version == (rental.version if rental else 0)
            )
            return {
                "quotation_id": str(quotation_id),
                "quotation_version": header.current_version,
                "rental_version": rental.version if rental else 0,
                "contract": view,
                "matches_current_business": matches,
                "ready_for_pickup": bool(
                    matches and view and view["signature_state"] == "signed"
                ),
            }

    def event(
        self,
        identifier: UUID,
        number: int,
        payload: DeliveryCommand | SignatureCommand | SignatureValidation,
        actor: Identity,
        upload: tuple[bytes, str | None] | None = None,
        attachment_id: UUID | None = None,
    ) -> dict[str, object]:
        kind = (
            "delivery"
            if isinstance(payload, DeliveryCommand)
            else "signature_validation"
            if isinstance(payload, SignatureValidation)
            else "signature_upload"
        )
        content_type = validate_proof(*upload) if upload else None
        if kind == "signature_upload" and upload is None:
            raise invalid("Selecione o documento assinado.")
        if (
            isinstance(payload, SignatureCommand)
            and payload.reviewed
            and (not payload.signed_date or not payload.declaration)
        ):
            raise invalid(
                "Conferência exige data de assinatura e declaração explícita."
            )
        if (
            isinstance(payload, SignatureCommand)
            and not payload.reviewed
            and (payload.signed_date or payload.declaration)
        ):
            raise invalid("Marque a conferência para registrar assinatura.")
        business_date = getattr(payload, "business_date", None) or getattr(
            payload, "signed_date", None
        )
        if business_date and business_date > self.clock().astimezone(SAO_PAULO).date():
            raise invalid("Registre somente entrega/assinatura já realizadas.")
        operation = f"{kind}:{identifier}:{number}"
        digest = canonical_hash(
            {
                "payload": payload.model_dump(mode="json"),
                "attachment": str(attachment_id) if attachment_id else None,
                "upload": hashlib.sha256(upload[0]).hexdigest() if upload else None,
                "type": content_type,
            }
        )
        stored: StoredProof | None = None
        quotation_id: UUID | None = None
        try:
            with session_scope(self.factory) as session:
                replay = self._request(session, operation, payload, actor, digest)
                if replay is not None:
                    return replay
                reference = self._series(session, identifier)
                quotation_id = reference.quotation_id
                # Universal order: request -> quotation -> rental -> finance -> series.
                self.payments._quotation(session, quotation_id, write=True)
                rental_for_quotation(session, quotation_id, locked=True)
                session.scalar(
                    select(PaymentAccount)
                    .where(PaymentAccount.quotation_id == quotation_id)
                    .with_for_update()
                )
                series = self._series(session, identifier, locked=True)
                row = session.get(ContractVersion, (identifier, number))
                if row is None:
                    raise PaymentError(404, "not_found", "Versão não encontrada.")
                if series.current_version != payload.expected_contract_version:
                    raise conflict()
                details = payload.model_dump(
                    mode="json",
                    exclude={
                        "request_id",
                        "expected_contract_version",
                        "reviewed",
                        "signed_date",
                        "declaration",
                    }
                    if kind == "signature_upload"
                    else {"request_id", "expected_contract_version"},
                )
                if upload and content_type:
                    stored = self.documents.write(upload[0], content_type)
                    details.update(
                        content_type=content_type,
                        size=stored.size,
                        sha256=stored.sha256,
                    )
                position = len(self._events(session, series, number)) + 1
                event = ContractEvent(
                    id=uuid4(),
                    series_id=identifier,
                    number=number,
                    kind=kind,
                    position=position,
                    data=details,
                    storage_key=stored.key if stored else None,
                    actor_id=actor.user_id,
                    session_id=actor.session_id,
                    created_at=self.clock(),
                )
                if isinstance(payload, SignatureValidation):
                    uploads = [
                        item
                        for item in self._events(session, series, number)
                        if item.kind == "signature_upload"
                    ]
                    if not uploads or uploads[-1].id != attachment_id:
                        raise invalid("Confira o anexo mais recente desta versão.")
                    details["attachment_id"] = str(attachment_id)
                session.add(event)
                if isinstance(payload, SignatureCommand) and payload.reviewed:
                    session.add(
                        ContractEvent(
                            id=uuid4(),
                            series_id=identifier,
                            number=number,
                            kind="signature_validation",
                            position=position + 1,
                            data={
                                "attachment_id": str(event.id),
                                "signed_date": payload.signed_date.isoformat()
                                if payload.signed_date
                                else None,
                                "declaration": payload.declaration,
                            },
                            storage_key=None,
                            actor_id=actor.user_id,
                            session_id=actor.session_id,
                            created_at=self.clock(),
                        )
                    )
                session.flush()
                result = self._version(session, series, row)
                self._save_request(session, operation, payload, actor, digest, result)
                return result
        except BaseException:
            if stored and quotation_id:
                self._compensate_document(quotation_id, stored.key)
            raise

    def _compensate_document(self, quotation_id: UUID, key: str) -> None:
        try:
            with session_scope(self.factory) as session:
                self.payments._quotation(session, quotation_id, write=True)
                found = session.scalar(
                    select(ContractVersion.storage_key).where(
                        ContractVersion.storage_key == key
                    )
                ) or session.scalar(
                    select(ContractEvent.storage_key).where(
                        ContractEvent.storage_key == key
                    )
                )
                if not found:
                    self.documents.compensate(key)
        except Exception:
            return  # Unknown commit: retain owned orphan; never delete history.

    def download(
        self, identifier: UUID, number: int, attachment_id: UUID | None = None
    ) -> tuple[bytes, str, str]:
        with session_scope(self.factory) as session:
            self._series(session, identifier)
            version = session.get(ContractVersion, (identifier, number))
            if version is None:
                raise PaymentError(404, "not_found", "Versão não encontrada.")
            if attachment_id:
                event = session.get(ContractEvent, attachment_id)
                if (
                    event is None
                    or event.series_id != identifier
                    or event.number != number
                    or event.kind != "signature_upload"
                    or not event.storage_key
                ):
                    raise PaymentError(
                        404, "not_found", "Anexo não encontrado nesta versão."
                    )
                key, size, sha = (
                    event.storage_key,
                    int(str(event.data["size"])),
                    str(event.data["sha256"]),
                )
                content_type = str(event.data["content_type"])
            else:
                key, size, sha, content_type = (
                    version.storage_key,
                    version.pdf_size,
                    version.pdf_sha256,
                    "application/pdf",
                )
        data = self.documents.read(key, size, sha)
        extension = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}[
            content_type
        ]
        return (
            data,
            content_type,
            f"{'assinatura' if attachment_id else 'contrato'}-v{number}.{extension}",
        )
