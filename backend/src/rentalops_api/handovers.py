"""Custody commands share deterministic transactions with stock and finance."""

import hashlib
import json
from datetime import date, timedelta
from decimal import Decimal
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from rentalops_api.auth import Identity
from rentalops_api.capacity import capacity_view
from rentalops_api.catalog import custody_stock_movement
from rentalops_api.catalog_models import MaintenanceEntry, Product
from rentalops_api.contract_models import ContractEvent, ContractSeries, ContractVersion
from rentalops_api.database import session_scope
from rentalops_api.handover_contracts import (
    FinancialAgreementCommand,
    ForecastCommand,
    HandoverCommand,
    HandoverVersions,
    OperationalCommand,
    ResolutionCommand,
    ReturnCommand,
)
from rentalops_api.handover_models import (
    FinancialAgreement,
    Handover,
    Incident,
    IncidentResolution,
    OperationalEvent,
    ReturnEvent,
    ReturnForecast,
)
from rentalops_api.payment_models import (
    PaymentAccount,
    PaymentAllocation,
    PaymentHistory,
)
from rentalops_api.quotation_contracts import SAO_PAULO
from rentalops_api.quotation_models import Quotation
from rentalops_api.rental_changes import RentalChangeService
from rentalops_api.rental_effects import record_inventory_impact
from rentalops_api.rental_models import (
    Rental,
    RentalAllocation,
    RentalHistory,
    RentalRequest,
)
from rentalops_api.rentals import RentalError, snapshot_demand, version_conflict


def rows_for[T: OperationalEvent](
    session: Session, model: type[T], identifier: UUID
) -> list[T]:
    return list(
        session.scalars(
            select(model)
            .where(model.rental_id == identifier)
            .order_by(model.created_at, model.id)
        )
    )


def incident_balance(session: Session, incident: Incident) -> tuple[int, int]:
    resolutions = list(
        session.scalars(
            select(IncidentResolution).where(
                IncidentResolution.incident_id == incident.id
            )
        )
    )
    physical = sum(
        row.quantity for row in resolutions if row.disposition != "maintenance"
    )
    accounted = sum(
        row.quantity for row in resolutions if row.disposition == "maintenance"
    )
    if incident.kind == "outstanding":
        physical += sum(
            int(str(line["quantity"]))
            for event in rows_for(session, ReturnEvent, incident.rental_id)
            for line in event.lines
            if line["product_id"] == str(incident.product_id)
        )
    return incident.quantity - physical, accounted


class HandoverService(RentalChangeService):
    def _contract(
        self,
        session: Session,
        rental: Rental,
        expected: int | None = None,
        *,
        locked: bool = False,
    ) -> dict[str, object]:
        query = select(ContractSeries).where(
            ContractSeries.quotation_id == rental.quotation_id
        )
        if locked:
            query = query.with_for_update().execution_options(populate_existing=True)
        series = session.scalar(query)
        number = series.current_version if series else 0
        if expected is not None and expected != number:
            raise version_conflict()
        row = (
            session.get(ContractVersion, (series.id, number))
            if series and number
            else None
        )
        events = (
            list(
                session.scalars(
                    select(ContractEvent)
                    .where(
                        ContractEvent.series_id == series.id,
                        ContractEvent.number == number,
                    )
                    .order_by(ContractEvent.position)
                )
            )
            if series
            else []
        )
        uploads = [event for event in events if event.kind == "signature_upload"]
        signed = bool(
            uploads
            and any(
                event.kind == "signature_validation"
                and event.data["attachment_id"] == str(uploads[-1].id)
                for event in events
            )
        )
        current = bool(
            row
            and row.quotation_version == rental.quotation_version
            and row.rental_version == rental.version
        )
        return {
            "id": str(series.id) if series else None,
            "version": number,
            "signed": signed,
            "matches_current_business": current,
            "ready_for_pickup": signed and current,
            "template_revision": row.template_revision if row else None,
        }

    def handover_preview(
        self, identifier: UUID, payload: HandoverVersions
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            _, _, rental, financial = self._context(
                session, identifier, payload, locked=False
            )
            assert rental is not None
            contract = self._contract(
                session, rental, payload.expected_contract_version
            )
            result = self._operations(session, rental)
            demand = snapshot_demand(rental.commercial_snapshot)
            products = {
                row.id: row
                for row in session.scalars(
                    select(Product).where(Product.id.in_(demand))
                )
            }
            today = self.clock().astimezone(SAO_PAULO).date()
            planned = date.fromisoformat(str(rental.commercial_snapshot["return_date"]))
            capacity = capacity_view(
                session,
                products,
                demand,
                today,
                max(today, planned),
                exclude_rental=rental.id,
                today=today,
            )
            result.update(
                contract=contract, financial=financial, capacity=capacity, readonly=True
            )
            return result

    def get_operations(self, identifier: UUID) -> dict[str, object]:
        with session_scope(self.factory) as session:
            rental = session.get(Rental, identifier)
            if rental is None:
                raise RentalError(404, "not_found", "Locação não encontrada.")
            return self._operations(session, rental)

    def _operations(self, session: Session, rental: Rental) -> dict[str, object]:
        handovers = rows_for(session, Handover, rental.id)
        handover = handovers[0] if handovers else None
        returns = rows_for(session, ReturnEvent, rental.id)
        incidents = rows_for(session, Incident, rental.id)
        resolutions = rows_for(session, IncidentResolution, rental.id)
        agreements = rows_for(session, FinancialAgreement, rental.id)
        forecasts = rows_for(session, ReturnForecast, rental.id)
        lines = handover.lines if handover else self._expected_lines(rental)
        quantities = []
        for line in lines:
            received = sum(
                int(str(item["quantity"]))
                for event in returns
                for item in event.lines
                if item["product_id"] == line["product_id"]
            )
            lost = sum(
                row.quantity
                for row in resolutions
                if row.disposition == "lost"
                and any(
                    i.id == row.incident_id
                    and i.kind == "outstanding"
                    and str(i.product_id) == line["product_id"]
                    for i in incidents
                )
            )
            total_lost = sum(
                row.quantity
                for row in resolutions
                if row.disposition == "lost"
                and any(
                    i.id == row.incident_id and str(i.product_id) == line["product_id"]
                    for i in incidents
                )
            )
            quantities.append(
                {
                    **line,
                    "received": received,
                    "lost": total_lost,
                    "outstanding": int(str(line["quantity"])) - received - lost,
                }
            )
        header = session.get(Quotation, rental.quotation_id)
        assert header is not None
        financial = self._view(session, rental, header)["current_financial"]
        pending = [
            i
            for i in incidents
            if (
                incident_balance(session, i)[0]
                > (0 if i.kind == "outstanding" else incident_balance(session, i)[1])
            )
        ]
        planned = date.fromisoformat(str(rental.commercial_snapshot["return_date"]))
        today = self.clock().astimezone(SAO_PAULO).date()

        def event_view(
            row: Handover
            | ReturnEvent
            | IncidentResolution
            | FinancialAgreement
            | ReturnForecast,
        ) -> dict[str, object]:
            values: dict[str, object] = {
                "id": str(row.id),
                "actor_id": str(row.actor_id),
                "created_at": row.created_at.isoformat(),
                "reason": row.reason,
            }
            for key in (
                "business_date",
                "lines",
                "observation",
                "quantity",
                "disposition",
                "effective_date",
                "kind",
                "financial_version",
                "third_party",
                "balance_exception",
            ):
                if hasattr(row, key):
                    value = getattr(row, key)
                    values[key] = (
                        value.isoformat() if isinstance(value, date) else value
                    )
            if isinstance(row, FinancialAgreement):
                values.update(
                    amount=format(row.amount, ".2f"), incident_id=str(row.incident_id)
                )
            if isinstance(row, IncidentResolution):
                values["incident_id"] = str(row.incident_id)
            if isinstance(row, (Handover, FinancialAgreement)):
                values.update(
                    contract_id=str(row.contract_id),
                    contract_version=row.contract_version,
                )
            return values

        return {
            "rental_id": str(rental.id),
            "rental_version": rental.version,
            "quotation_version": rental.quotation_version,
            "financial_version": cast(dict[str, object], financial)[
                "financial_version"
            ],
            "contract": self._contract(session, rental),
            "financial": financial,
            "state": rental.state,
            "handover": event_view(handover) if handover else None,
            "lines": quantities,
            "returns": [event_view(row) for row in returns],
            "incidents": [
                {
                    "id": str(i.id),
                    "product_id": str(i.product_id),
                    "kind": i.kind,
                    "quantity": i.quantity,
                    "remaining": incident_balance(session, i)[0],
                    "maintenance_decided": incident_balance(session, i)[1],
                    "maintenance_id": str(i.maintenance_id)
                    if i.maintenance_id
                    else None,
                    "received_date": i.received_date.isoformat()
                    if i.received_date
                    else None,
                    "reason": i.reason,
                    "actor_id": str(i.actor_id),
                }
                for i in incidents
            ],
            "resolutions": [event_view(row) for row in resolutions],
            "agreements": [event_view(row) for row in agreements],
            "forecasts": [event_view(row) for row in forecasts],
            "late": today > planned
            and any(row["outstanding"] for row in quantities)
            and handover is not None,
            "can_close": rental.state == "out" and not pending,
        }

    def _expected_lines(self, rental: Rental) -> list[dict[str, object]]:
        names = {
            str(item["product_id"]): str(item["name"])
            for line in cast(
                list[dict[str, object]], rental.commercial_snapshot["lines"]
            )
            for item in cast(list[dict[str, object]], line["items"])
        }
        return [
            {
                "product_id": str(pid),
                "name": names[str(pid)],
                "quantity": qty,
                "condition": "",
            }
            for pid, qty in sorted(snapshot_demand(rental.commercial_snapshot).items())
        ]

    def execute(
        self,
        identifier: UUID,
        operation: str,
        payload: OperationalCommand,
        actor: Identity,
        incident_id: UUID | None = None,
    ) -> tuple[dict[str, object], bool]:
        op = f"{operation}:{incident_id or identifier}"
        digest = hashlib.sha256(
            json.dumps(
                payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        key = int.from_bytes(
            hashlib.sha256(
                f"custody:{actor.user_id}:{op}:{payload.request_id}".encode()
            ).digest()[:8],
            "big",
            signed=True,
        )
        with session_scope(self.factory) as session, session.no_autoflush:
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
            replay = session.get(RentalRequest, (actor.user_id, op, payload.request_id))
            if replay:
                if replay.result["rental_id"] != str(identifier):
                    raise RentalError(
                        404, "not_found", "Ocorrência não encontrada nesta locação."
                    )
                if replay.payload_hash != digest:
                    raise RentalError(
                        409,
                        "idempotency_conflict",
                        "Esta chave já foi usada com outros dados. "
                        "Consulte a operação original.",
                    )
                return replay.result, True
            header, _, rental, financial = self._context(
                session, identifier, payload, locked=True
            )
            assert rental is not None
            contract = self._contract(
                session, rental, payload.expected_contract_version, locked=True
            )
            products = {
                row.id: row
                for row in session.scalars(
                    select(Product)
                    .where(Product.id.in_(snapshot_demand(rental.commercial_snapshot)))
                    .order_by(Product.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            }
            before = self._operations(session, rental)
            handovers = rows_for(session, Handover, rental.id)
            handover = handovers[0] if handovers else None
            if operation == "handover":
                assert isinstance(payload, HandoverCommand)
                self._handover(
                    session, rental, payload, actor, financial, contract, products
                )
            else:
                if handover is None or rental.state not in {"out", "completed"}:
                    raise RentalError(
                        409,
                        "invalid_state",
                        "Registre a saída antes de conferir o retorno.",
                    )
                if rental.state == "completed" and operation not in {
                    "resolution",
                    "agreement",
                }:
                    raise RentalError(
                        409,
                        "invalid_state",
                        "Locação já encerrada. Consulte o histórico.",
                    )
                if operation == "return":
                    assert isinstance(payload, ReturnCommand)
                    self._return(session, rental, handover, payload, actor, products)
                elif operation == "forecast":
                    assert isinstance(payload, ForecastCommand)
                    if (
                        payload.business_date
                        < self.clock().astimezone(SAO_PAULO).date()
                    ):
                        raise RentalError(
                            422, "invalid_date", "Informe uma previsão atual ou futura."
                        )
                    session.add(
                        ReturnForecast(
                            **self._event(rental, actor, payload.reason),
                            business_date=payload.business_date,
                        )
                    )
                elif operation in {"resolution", "agreement"}:
                    incident = session.get(Incident, incident_id)
                    if incident is None or incident.rental_id != identifier:
                        raise RentalError(
                            404, "not_found", "Ocorrência não encontrada nesta locação."
                        )
                    if operation == "resolution":
                        assert isinstance(payload, ResolutionCommand)
                        self._resolve(
                            session,
                            rental,
                            incident,
                            payload,
                            actor,
                            products[incident.product_id],
                        )
                    else:
                        assert isinstance(payload, FinancialAgreementCommand)
                        self._agreement(
                            session,
                            rental,
                            incident,
                            payload,
                            actor,
                            contract,
                            financial,
                        )
                elif operation == "close":
                    if not before["can_close"]:
                        raise RentalError(
                            409,
                            "operational_pending",
                            "Confira todos os faltantes e registre a decisão "
                            "das ocorrências antes de encerrar.",
                        )
                    rental.state = "completed"
                else:
                    raise ValueError("Unknown custody operation.")
            rental.version += 1
            if operation == "agreement":
                account = session.get(PaymentAccount, rental.quotation_id)
                assert account is not None
                rental.financial_version = account.version
            rental.actor_id, rental.session_id, rental.checked_at = (
                actor.user_id,
                actor.session_id,
                self.clock(),
            )
            session.flush()
            # Allocation rows contain outstanding only; actual returned intervals
            # and sourced maintenance are read by the shared capacity service.
            if handover:
                for allocation in session.scalars(
                    select(RentalAllocation).where(
                        RentalAllocation.rental_id == rental.id
                    )
                ):
                    origin = next(
                        i
                        for i in rows_for(session, Incident, rental.id)
                        if i.product_id == allocation.product_id
                        and i.kind == "outstanding"
                    )
                    allocation.quantity = incident_balance(session, origin)[0]
                    if allocation.quantity == 0:
                        session.delete(allocation)
            session.flush()
            for product in products.values():
                record_inventory_impact(session, product, actor)
            result = self._operations(session, rental)
            session.add(
                RentalHistory(
                    rental_id=rental.id,
                    version=rental.version,
                    operation=operation,
                    reason=payload.reason,
                    before=before,
                    after=result,
                    actor_id=actor.user_id,
                    session_id=actor.session_id,
                    created_at=self.clock(),
                )
            )
            session.add(
                RentalRequest(
                    actor_id=actor.user_id,
                    operation=op,
                    request_id=payload.request_id,
                    payload_hash=digest,
                    status=201,
                    result=result,
                )
            )
            session.commit()
            return result, False

    def _event(self, rental: Rental, actor: Identity, reason: str) -> dict[str, object]:
        return {
            "id": uuid4(),
            "rental_id": rental.id,
            "actor_id": actor.user_id,
            "session_id": actor.session_id,
            "reason": reason,
            "created_at": self.clock(),
        }

    def _handover(
        self,
        session: Session,
        rental: Rental,
        payload: HandoverCommand,
        actor: Identity,
        financial: dict[str, object],
        contract: dict[str, object],
        products: dict[UUID, Product],
    ) -> None:
        if rental.state != "confirmed":
            raise RentalError(
                409,
                "invalid_state",
                "Saída exige reserva confirmada e ainda não entregue.",
            )
        if not contract["ready_for_pickup"]:
            raise RentalError(
                409,
                "signature_required",
                "Registre e confira a assinatura do contrato da versão vigente "
                "antes da saída.",
            )
        if not financial["deposit_validated"]:
            raise RentalError(
                409,
                "deposit_required",
                "Concilie o sinal válido. A exceção de saldo não dispensa o sinal.",
            )
        if Decimal(str(financial["remaining"])) > 0 and not payload.balance_exception:
            raise RentalError(
                409,
                "balance_required",
                "Quite o saldo ou registre a exceção financeira com justificativa.",
            )
        if {
            line.product_id: line.quantity for line in payload.lines
        } != snapshot_demand(rental.commercial_snapshot):
            raise RentalError(
                422,
                "integral_handover",
                "Confira todos os produtos e quantidades acordados. "
                "Diferenças exigem alteração antes da saída.",
            )
        expected = {line["product_id"]: line for line in self._expected_lines(rental)}
        today = self.clock().astimezone(SAO_PAULO).date()
        capacity = capacity_view(
            session,
            products,
            snapshot_demand(rental.commercial_snapshot),
            today,
            max(
                today,
                date.fromisoformat(str(rental.commercial_snapshot["return_date"])),
            ),
            exclude_rental=rental.id,
            today=today,
        )
        if any(row["shortage"] for row in capacity):
            raise RentalError(
                409,
                "capacity_conflict",
                "Há conflito físico de estoque. Resolva com a equipe antes da saída.",
                capacity=capacity,
            )
        lines = [
            {**expected[str(line.product_id)], **line.model_dump(mode="json")}
            for line in payload.lines
        ]
        session.add(
            Handover(
                **self._event(rental, actor, payload.reason),
                business_date=self.clock().astimezone(SAO_PAULO).date(),
                contract_id=UUID(str(contract["id"])),
                contract_version=contract["version"],
                lines=lines,
                third_party=payload.third_party.model_dump()
                if payload.third_party
                else None,
                balance_exception=payload.balance_exception,
            )
        )
        for line in payload.lines:
            session.add(
                Incident(
                    **self._event(
                        rental,
                        actor,
                        "Material entregue; conferir recebimento real "
                        "ou formalizar perda.",
                    ),
                    product_id=line.product_id,
                    quantity=line.quantity,
                    kind="outstanding",
                )
            )
        rental.state = "out"

    def _return(
        self,
        session: Session,
        rental: Rental,
        handover: Handover,
        payload: ReturnCommand,
        actor: Identity,
        products: dict[UUID, Product],
    ) -> None:
        if (
            not handover.business_date
            <= payload.business_date
            <= self.clock().astimezone(SAO_PAULO).date()
        ):
            raise RentalError(
                422,
                "invalid_date",
                "O recebimento deve ser real, não futuro e posterior ou igual à saída.",
            )
        origins = {
            i.product_id: i
            for i in rows_for(session, Incident, rental.id)
            if i.kind == "outstanding"
        }
        requested: dict[UUID, int] = {}
        for line in payload.lines:
            requested[line.product_id] = (
                requested.get(line.product_id, 0) + line.quantity
            )
        if any(
            pid not in origins or qty > incident_balance(session, origins[pid])[0]
            for pid, qty in requested.items()
        ):
            raise RentalError(
                422,
                "invalid_quantity",
                "Receba apenas produtos enviados e até o saldo ainda não recebido.",
            )
        event = ReturnEvent(
            **self._event(rental, actor, payload.reason),
            business_date=payload.business_date,
            lines=[line.model_dump(mode="json") for line in payload.lines],
            observation=payload.observation,
        )
        session.add(event)
        session.flush()
        for line in payload.lines:
            if line.condition != "fit":
                entry = custody_stock_movement(
                    session,
                    products[line.product_id],
                    actor,
                    "maintenance",
                    line.quantity,
                    payload.reason,
                    self.clock(),
                )
                assert entry is not None
                session.add(
                    Incident(
                        **self._event(rental, actor, payload.reason),
                        product_id=line.product_id,
                        quantity=line.quantity,
                        kind=line.condition,
                        return_event_id=event.id,
                        maintenance_id=entry.id,
                        received_date=payload.business_date,
                    )
                )

    def _resolve(
        self,
        session: Session,
        rental: Rental,
        incident: Incident,
        payload: ResolutionCommand,
        actor: Identity,
        product: Product,
    ) -> None:
        remaining, accounted = incident_balance(session, incident)
        if payload.quantity > remaining or (
            payload.disposition == "maintenance"
            and payload.quantity > remaining - accounted
        ):
            raise RentalError(
                422, "invalid_quantity", "Quantidade supera o saldo desta ocorrência."
            )
        if incident.kind == "outstanding" and payload.disposition != "lost":
            raise RentalError(
                422,
                "actual_return_required",
                "Faltantes exigem recebimento real ou perda formalizada.",
            )
        if payload.disposition == "repaired" and incident.kind != "damaged":
            raise RentalError(
                422, "invalid_resolution", "Reparo exige ocorrência de avaria."
            )
        entry = (
            session.get(MaintenanceEntry, incident.maintenance_id)
            if incident.maintenance_id
            else None
        )
        if payload.disposition == "maintenance" and (
            entry is None or incident.received_date is None
        ):
            raise RentalError(
                422,
                "actual_return_required",
                "Encaminhamento exige quantidade recebida em manutenção vinculada.",
            )
        today = self.clock().astimezone(SAO_PAULO).date()
        if payload.disposition == "lost":
            repair_charged = sum(
                session.scalars(
                    select(FinancialAgreement.quantity).where(
                        FinancialAgreement.incident_id == incident.id,
                        FinancialAgreement.kind == "repair",
                    )
                )
            )
            lost_already = sum(
                session.scalars(
                    select(IncidentResolution.quantity).where(
                        IncidentResolution.incident_id == incident.id,
                        IncidentResolution.disposition == "lost",
                    )
                )
            )
            if repair_charged + lost_already + payload.quantity > incident.quantity:
                raise RentalError(
                    422,
                    "duplicate_damage_charge",
                    "A quantidade tem acordo de reparo. Resolva o acordo "
                    "antes de formalizar perda dessa quantidade.",
                )
        effective = (
            max(today, incident.received_date + timedelta(days=1))
            if incident.received_date
            and payload.disposition in {"repaired", "released"}
            else today
        )
        if payload.disposition != "maintenance":
            custody_stock_movement(
                session,
                product,
                actor,
                "withdrawal" if payload.disposition == "lost" else "release",
                payload.quantity,
                payload.reason,
                self.clock(),
                entry,
            )
        session.add(
            IncidentResolution(
                **self._event(rental, actor, payload.reason),
                incident_id=incident.id,
                quantity=payload.quantity,
                disposition=payload.disposition,
                effective_date=effective,
            )
        )

    def _agreement(
        self,
        session: Session,
        rental: Rental,
        incident: Incident,
        payload: FinancialAgreementCommand,
        actor: Identity,
        contract: dict[str, object],
        financial: dict[str, object],
    ) -> None:
        if (
            not contract["signed"]
            or contract["template_revision"] != "pegue-e-monte-v0.4"
        ):
            raise RentalError(
                409,
                "terms_required",
                "Confira os termos aplicáveis aprovados e a assinatura "
                "antes de registrar o acordo.",
            )
        prior = list(
            session.scalars(
                select(FinancialAgreement).where(
                    FinancialAgreement.incident_id == incident.id
                )
            )
        )
        loss_quantity = sum(
            session.scalars(
                select(IncidentResolution.quantity).where(
                    IncidentResolution.incident_id == incident.id,
                    IncidentResolution.disposition == "lost",
                )
            )
        )
        charged_repair = sum(row.quantity for row in prior if row.kind == "repair")
        charged_replacement = sum(
            row.quantity for row in prior if row.kind == "replacement"
        )
        if (
            payload.kind == "replacement"
            and payload.quantity + charged_replacement > loss_quantity
        ) or (
            payload.kind == "repair"
            and payload.quantity + charged_repair + loss_quantity > incident.quantity
        ):
            raise RentalError(
                422,
                "duplicate_damage_charge",
                "O acordo deve corresponder a quantidades distintas, "
                "sem reparo e reposição para o mesmo dano.",
            )
        total_extra = sum(
            session.scalars(
                select(FinancialAgreement.amount).where(
                    FinancialAgreement.rental_id == rental.id
                )
            ),
            Decimal(0),
        )
        if Decimal(str(financial["total"])) + total_extra + payload.amount > Decimal(
            "9999999999.99"
        ):
            raise RentalError(
                422, "money_limit", "O total das obrigações excede o limite financeiro."
            )
        if payload.quantity > incident.quantity or (
            payload.kind in {"repair", "replacement"}
            and payload.quantity
            + sum(
                row.quantity for row in prior if row.kind in {"repair", "replacement"}
            )
            > incident.quantity
        ):
            raise RentalError(
                422,
                "duplicate_damage_charge",
                "Não acumule reparo e reposição para a mesma quantidade e ocorrência.",
            )
        if (payload.kind == "repair" and incident.kind != "damaged") or (
            payload.kind == "replacement"
            and not any(
                row.disposition == "lost"
                for row in session.scalars(
                    select(IncidentResolution).where(
                        IncidentResolution.incident_id == incident.id
                    )
                )
            )
        ):
            raise RentalError(
                422,
                "invalid_agreement",
                "Reparo exige avaria; reposição exige perda formalizada.",
            )
        account = session.get(PaymentAccount, rental.quotation_id)
        assert account is not None
        applications = self.payments._applications(session, account)
        account.version += 1
        session.add(
            FinancialAgreement(
                **self._event(rental, actor, payload.reason),
                incident_id=incident.id,
                quantity=payload.quantity,
                kind=payload.kind,
                amount=payload.amount,
                financial_version=account.version,
                contract_id=UUID(str(contract["id"])),
                contract_version=contract["version"],
            )
        )
        session.add(
            PaymentHistory(
                quotation_id=rental.quotation_id,
                quotation_version=rental.quotation_version,
                financial_version=account.version,
                operation="incident_agreement",
                actor_id=actor.user_id,
                session_id=actor.session_id,
                reason=payload.reason,
                before=financial,
                after={
                    "incident_id": str(incident.id),
                    "kind": payload.kind,
                    "amount": format(payload.amount, ".2f"),
                    "quantity": payload.quantity,
                },
                created_at=self.clock(),
            )
        )
        session.flush()
        session.add_all(
            [
                PaymentAllocation(
                    quotation_id=rental.quotation_id,
                    financial_version=account.version,
                    receipt_id=UUID(row["receipt_id"]),
                    deposit=Decimal(row["deposit"]),
                    balance=Decimal(row["balance"]),
                )
                for row in applications
            ]
        )
