import io
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal
from threading import Barrier
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from pypdf import PdfReader
from sqlalchemy import func, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from locatto_api.catalog_models import Kit, KitItem, Product, ProductPhoto
from locatto_api.catalog_storage import PhotoStorage, normalize_image
from locatto_api.contract_contracts import (
    CompanyCommand,
    ContractIssue,
    ContractPreview,
    DeliveryCommand,
    LogoCommand,
    SignatureCommand,
    SignatureValidation,
)
from locatto_api.contract_models import (
    CompanyRevision,
    ContractEvent,
    ContractRequest,
    ContractSeries,
    ContractVersion,
)
from locatto_api.contracts import ContractService
from locatto_api.customer_models import Customer
from locatto_api.models import Base
from locatto_api.payment_errors import PaymentError
from locatto_api.rental_models import RentalAllocation

from ..conftest import migration_config
from ..unit.test_contract_contracts import image_bytes, synthetic_cpf
from ..unit.test_payment_storage import pdf
from .test_quotations import create
from .test_quotations import quotations as quotation_fixture
from .test_rental_changes import change_command, confirmed
from .test_rental_changes import changes as changes_fixture

pytestmark = pytest.mark.integration


def synthetic_address():
    # Runtime-only synthetic contact data; no customer's address is a fixture.
    marker = uuid4().hex[:8]
    return {
        "street": f"Via Sintética {marker}",
        "number": "TESTE",
        "neighborhood": f"Setor Sintético {marker}",
        "city": f"Cidade Sintética {marker}",
        "state": "SP",
        "postal_code": "00000000",
    }


@pytest.fixture
def contracts(migrated_engine, tmp_path):
    quotes = quotation_fixture.__wrapped__(migrated_engine)
    offer = create(quotes)
    service = ContractService(
        quotes[0].factory,
        PhotoStorage(tmp_path),
        clock=lambda: datetime(2026, 10, 10, 12, tzinfo=UTC),
    )
    return service, quotes[1], UUID(offer["id"]), quotes


def parameters(service, **changes):
    return CompanyCommand.model_validate(
        {
            "request_id": str(uuid4()),
            "expected_version": service.company()["version"],
            "name": "Locadora Sintética",
            "identification": "IDENTIFICAÇÃO SINTÉTICA",
            "address": synthetic_address(),
            "contact": "Contato sintético",
            **changes,
        }
    )


def ready(contracts):
    service, actor, _, quotes = contracts
    service.update_company(parameters(service), actor)
    with service.factory.begin() as session:
        customer = session.get(Customer, quotes[2]["customer"])
        customer.cpf = synthetic_cpf()
        customer.address = synthetic_address()
        for index, product_id in enumerate([quotes[2]["arch"], quotes[2]["vase"]]):
            stored = service.photos.write(image_bytes(index == 0), "PNG")
            session.add(
                ProductPhoto(
                    product_id=product_id,
                    storage_key=stored.key,
                    format="PNG",
                    size=stored.size,
                    sha256=stored.sha256,
                    position=0,
                    is_principal=True,
                    is_attached=True,
                    created_by=actor.user_id,
                )
            )


def issue_command(contracts, **changes):
    service, _, identifier, quotes = contracts
    money = service.payments.get(identifier)
    state = service.signature_state(identifier)
    return ContractIssue.model_validate(
        {
            "request_id": str(uuid4()),
            "expected_quotation_version": money["quotation_version"],
            "expected_financial_version": money["financial_version"],
            "expected_rental_version": state["rental_version"],
            "expected_contract_version": state["contract"]["current_version"]
            if state["contract"]
            else 0,
            "expected_company_version": service.company()["version"],
            "event_address": synthetic_address(),
            "items": [
                {"product_id": str(quotes[2][key]), "condition": "Bom estado sintético"}
                for key in ("arch", "vase")
            ],
            **changes,
        }
    )


def test_ctr01_progressive_optional_fields_before_signal_no_allocation(
    contracts,
):
    service, actor, identifier, _ = contracts
    command = issue_command(contracts, event_address={})
    preview = service.preview(
        identifier,
        ContractPreview.model_validate(command.model_dump(exclude={"request_id"})),
    )
    fields = {item["field"] for item in preview["pending"]}
    assert (
        "customer.cpf" in fields
        and "company.name" in fields
        and "event_address.street" in fields
    )
    assert not any(
        "replacement" in field or field == "company.logo" or field == "customer.rg"
        for field in fields
    )
    assert preview["state"] == "draft"
    with pytest.raises(PaymentError) as error:
        service.issue(identifier, command, actor)
    assert error.value.status == 422
    ready(contracts)
    before = service.payments.get(identifier)
    issued = service.issue(identifier, issue_command(contracts), actor)
    assert issued["number"] == 1 and issued["signature_state"] == "pending"
    assert (
        service.payments.get(identifier) == before and not before["deposit_validated"]
    )
    with service.factory() as session:
        assert session.scalar(select(func.count()).select_from(RentalAllocation)) == 0
        row = session.get(ContractVersion, (UUID(issued["contract_id"]), 1))
        assert row.snapshot["customer_rg"] is None and row.snapshot["logo"] is None
        demands = {item["name"]: item["quantity"] for item in row.snapshot["items"]}
        assert demands == {"Synthetic arch": 2, "Synthetic vase": 5}
        assert all(
            item["photo"] and item["condition"] and "replacement_value" not in item
            for item in row.snapshot["items"]
        )


def test_contract_issues_without_item_condition_but_keeps_required_photos(contracts):
    service, actor, identifier, quotes = contracts
    ready(contracts)
    payload = issue_command(
        contracts,
        items=[{"product_id": str(quotes[2][key])} for key in ("arch", "vase")],
    )
    preview = service.preview(
        identifier,
        ContractPreview.model_validate(payload.model_dump(exclude={"request_id"})),
    )
    assert preview["pending"] == []
    issued = service.issue(identifier, payload, actor)
    document = service.download(UUID(issued["contract_id"]), 1)[0]
    text = "\n".join(
        page.extract_text() for page in PdfReader(io.BytesIO(document)).pages
    )
    assert "Condição:" not in text
    assert "Entrada" not in text or "ENTRADA PAGA" in text
    assert "R$ 0,00" in text


def test_ctr02_missing_corrupt_photo_renderer_and_template_fail_closed(contracts):
    service, actor, identifier, quotes = contracts
    ready(contracts)
    with service.factory.begin() as session:
        photo = session.scalar(
            select(ProductPhoto).where(ProductPhoto.product_id == quotes[2]["arch"])
        )
        path = service.photos.checked_path(photo.storage_key)
        old = path.read_bytes()
        path.write_bytes(b"corruption")
    command = issue_command(contracts)
    preview = service.preview(
        identifier,
        ContractPreview.model_validate(command.model_dump(exclude={"request_id"})),
    )
    assert any(item["field"].endswith(".photo") for item in preview["pending"])
    with pytest.raises(PaymentError):
        service.issue(identifier, command, actor)
    path.write_bytes(old)
    with patch.object(
        service, "renderer", side_effect=RuntimeError("synthetic renderer fault")
    ):
        with pytest.raises(PaymentError) as error:
            service.issue(identifier, command, actor)
    assert error.value.code == "renderer_unavailable"
    with patch("locatto_api.contracts.TEMPLATE_DIGEST", "0" * 64):
        with pytest.raises(PaymentError) as error:
            service.issue(identifier, command, actor)
    assert error.value.code == "template_unavailable"
    assert service.versions(identifier, quotation=True) == []


def test_ctr02_negotiated_custom_kit_and_loose_items_are_frozen(contracts):
    service, actor, _, quotes = contracts
    ids = quotes[2]
    offer = create(
        quotes,
        lines=[
            {
                "kind": "kit",
                "source_id": str(ids["kit"]),
                "quantity": 2,
                "unit_price": "100.01",
                "negotiation_reason": "Synthetic custom agreement",
                "items": [
                    {"product_id": str(ids["arch"]), "quantity": 1},
                    {"product_id": str(ids["vase"]), "quantity": 1},
                ],
            },
            {"kind": "product", "source_id": str(ids["vase"]), "quantity": 3},
        ],
    )
    fixture = (service, actor, UUID(offer["id"]), quotes)
    ready(fixture)
    issued = service.issue(fixture[2], issue_command(fixture), actor)
    with service.factory() as session:
        stored = session.get(ContractVersion, (UUID(issued["contract_id"]), 1)).snapshot
        assert stored["total"] == "230.02" and stored["deposit"] == "115.01"
        assert {item["name"]: item["quantity"] for item in stored["items"]} == {
            "Synthetic arch": 2,
            "Synthetic vase": 5,
        }
        assert session.get(Kit, ids["kit"]).price == Decimal("195")
        assert sorted(row.quantity for row in session.scalars(select(KitItem))) == [
            1,
            2,
        ]
    content = service.download(UUID(issued["contract_id"]), 1)[0]
    text = "\n".join(
        page.extract_text() for page in PdfReader(io.BytesIO(content)).pages
    )
    assert "Synthetic kit" not in text
    assert "2 × Synthetic arch" in text and "5 × Synthetic vase" in text
    assert "R$ 230,02" in text
    assert "Condição:" not in text and "Contrato v1" not in text
    assert "Inclui" not in text


def test_ctr03_snapshots_company_logo_photo_changes_preserve_bytes_and_new_signature(
    contracts,
):
    service, actor, identifier, quotes = contracts
    ready(contracts)
    logo = LogoCommand(request_id=uuid4(), expected_version=1)
    service.update_company(logo, actor, (image_bytes(), "image/png"))
    first = service.issue(identifier, issue_command(contracts), actor)
    series_id = UUID(first["contract_id"])
    original = service.download(series_id, 1)[0]
    signed = service.event(
        series_id,
        1,
        SignatureCommand(
            request_id=uuid4(),
            expected_contract_version=1,
            reviewed=True,
            signed_date="2026-10-10",
            declaration="Conferência sintética da versão1",
        ),
        actor,
        (pdf(), "application/pdf"),
    )
    assert signed["signature_state"] == "signed"
    assert service.signature_state(identifier)["ready_for_pickup"]
    service.update_company(parameters(service, name="Outra Locadora Sintética"), actor)
    service.update_company(
        LogoCommand(request_id=uuid4(), expected_version=3, remove=True), actor
    )
    with service.factory.begin() as session:
        for photo in session.scalars(select(ProductPhoto)):
            photo.is_attached = False
            stored = service.photos.write(image_bytes(True), "PNG")
            session.add(
                ProductPhoto(
                    product_id=photo.product_id,
                    storage_key=stored.key,
                    format="PNG",
                    size=stored.size,
                    sha256=stored.sha256,
                    position=1,
                    is_principal=True,
                    is_attached=True,
                    created_by=actor.user_id,
                )
            )
        product = session.get(Product, quotes[2]["vase"])
        product.name = "Changed synthetic catalogue name"
    second = service.issue(identifier, issue_command(contracts), actor)
    assert second["number"] == 2 and second["signature_state"] == "pending"
    assert {item["field"] for item in second["differences"]} >= {
        "company",
        "company_version",
        "logo",
        "items",
    }
    assert service.download(series_id, 1)[0] == original
    assert service.version(series_id, 1)["signature_state"] == "signed"
    assert not service.signature_state(identifier)["ready_for_pickup"]
    text = "\n".join(
        page.extract_text()
        for page in PdfReader(io.BytesIO(service.download(series_id, 2)[0])).pages
    )
    assert (
        "Outra Locadora Sintética" in text
        and "Changed synthetic catalogue name" not in text
    )


def test_ctr04_delivery_upload_conference_revisions_and_attachment_linkage(contracts):
    service, actor, identifier, _ = contracts
    ready(contracts)
    first = service.issue(identifier, issue_command(contracts), actor)
    series_id = UUID(first["contract_id"])
    delivered = service.event(
        series_id,
        1,
        DeliveryCommand(
            request_id=uuid4(),
            expected_contract_version=1,
            method="in_person",
            business_date="2026-10-10",
            reason="Entrega sintética",
        ),
        actor,
    )
    assert delivered["delivered"] and delivered["signature_state"] == "pending"
    uploaded = service.event(
        series_id,
        1,
        SignatureCommand(request_id=uuid4(), expected_contract_version=1),
        actor,
        (image_bytes(), "image/png"),
    )
    assert uploaded["signature_state"] == "awaiting_review"
    attachment = UUID(uploaded["events"][-1]["id"])
    validation = SignatureValidation(
        request_id=uuid4(),
        expected_contract_version=1,
        signed_date="2026-10-10",
        declaration="Conferência manual sintética",
    )
    signed = service.event(series_id, 1, validation, actor, attachment_id=attachment)
    assert signed["signature_state"] == "signed"
    assert (
        service.event(series_id, 1, validation, actor, attachment_id=attachment)
        == signed
    )
    uploaded2 = service.event(
        series_id,
        1,
        SignatureCommand(request_id=uuid4(), expected_contract_version=1),
        actor,
        (image_bytes(True), "image/png"),
    )
    assert uploaded2["signature_state"] == "awaiting_review"
    assert service.download(series_id, 1, attachment)[0] == image_bytes()
    with pytest.raises(PaymentError):
        service.event(
            series_id,
            1,
            validation.model_copy(update={"request_id": uuid4()}),
            actor,
            attachment_id=attachment,
        )
    with pytest.raises(PaymentError) as error:
        service.download(series_id, 2, attachment)
    assert error.value.status == 404


def test_ctr05_same_key_replay_concurrent_keys_stale_and_payload_conflict(contracts):
    service, actor, identifier, _ = contracts
    ready(contracts)
    body = issue_command(contracts)
    barrier = Barrier(2)

    def execute(command):
        barrier.wait()
        try:
            return service.issue(identifier, command, actor)
        except PaymentError as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        same = list(pool.map(execute, [body, body]))
    assert same[0] == same[1] and len(service.versions(identifier, quotation=True)) == 1
    assert service.issue(identifier, body, actor) == same[0]
    with pytest.raises(PaymentError) as error:
        service.issue(
            identifier,
            body.model_copy(
                update={
                    "event_address": body.event_address.model_copy(
                        update={"number": "DIFFERENT"}
                    )
                }
            ),
            actor,
        )
    assert error.value.code == "idempotency_conflict"
    next_body = issue_command(contracts)
    with ThreadPoolExecutor(max_workers=2) as pool:
        racing = list(
            pool.map(
                execute,
                [next_body, next_body.model_copy(update={"request_id": uuid4()})],
            )
        )
    assert sorted(isinstance(item, dict) for item in racing) == [False, True]
    assert 409 in racing and len(service.versions(identifier, quotation=True)) == 2


def test_ctr05_rollback_compensates_only_owned_unknown_commit_retains_durable(
    contracts,
):
    service, actor, identifier, _ = contracts
    ready(contracts)
    first = service.issue(identifier, issue_command(contracts), actor)
    series_id = UUID(first["contract_id"])
    initial_files = set(service.photos.root.iterdir())
    with patch.object(
        Session, "commit", side_effect=RuntimeError("injected before commit")
    ):
        with pytest.raises(RuntimeError):
            service.issue(identifier, issue_command(contracts), actor)
    assert set(service.photos.root.iterdir()) == initial_files
    assert len(service.versions(identifier, quotation=True)) == 1
    original_commit = Session.commit

    def lost_ack(session):
        original_commit(session)
        raise RuntimeError("injected lost commit acknowledgement")

    body = issue_command(contracts)
    with patch.object(Session, "commit", lost_ack):
        with pytest.raises(RuntimeError):
            service.issue(identifier, body, actor)
    replay = service.issue(identifier, body, actor)
    assert replay["number"] == 2 and service.download(series_id, 2)[0].startswith(
        b"%PDF"
    )
    assert service.download(series_id, 1)[0].startswith(b"%PDF")


def test_ctr05_company_replay_concurrency_immutable(contracts):
    service, actor, _, _ = contracts
    body = parameters(service)
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(lambda _: service.update_company(body, actor), range(2)))
    assert result[0] == result[1] and result[0]["version"] == 1
    with pytest.raises(PaymentError) as error:
        service.update_company(body.model_copy(update={"name": "Different"}), actor)
    assert error.value.code == "idempotency_conflict"
    with service.factory() as session:
        assert session.scalar(select(func.count()).select_from(CompanyRevision)) == 1
        with pytest.raises(ProgrammingError):
            session.execute(text("UPDATE company_revisions SET data = '{}'"))


def test_contract_migration_upgrade_downgrade_metadata(isolated_engine):
    with isolated_engine.begin() as connection:
        config = migration_config(connection)
        command.upgrade(config, "0009_rental_changes")
        command.upgrade(config, "head")
        assert (
            compare_metadata(MigrationContext.configure(connection), Base.metadata)
            == []
        )
        command.downgrade(config, "0009_rental_changes")
        command.upgrade(config, "head")


def test_ctr05_logo_owned_rollback_unknown_commit_and_different_keys(contracts):
    service, actor, _, _ = contracts
    service.update_company(parameters(service), actor)
    service.update_company(
        LogoCommand(request_id=uuid4(), expected_version=1),
        actor,
        (image_bytes(), "image/png"),
    )
    old = service.company_logo()[0]
    files = set(service.photos.root.iterdir())
    with patch.object(Session, "commit", side_effect=RuntimeError("logo rollback")):
        with pytest.raises(RuntimeError):
            service.update_company(
                LogoCommand(request_id=uuid4(), expected_version=2),
                actor,
                (image_bytes(True), "image/png"),
            )
    assert set(service.photos.root.iterdir()) == files
    assert service.company_logo()[0] == old
    original = Session.commit

    def lost_ack(session):
        original(session)
        raise RuntimeError("logo commit acknowledgement lost")

    body = LogoCommand(request_id=uuid4(), expected_version=2)
    with patch.object(Session, "commit", lost_ack):
        with pytest.raises(RuntimeError):
            service.update_company(body, actor, (image_bytes(True), "image/png"))
    replay = service.update_company(body, actor, (image_bytes(True), "image/png"))
    expected, _ = normalize_image(image_bytes(True), "image/png")
    assert replay["version"] == 3 and service.company_logo()[0] == expected
    assert files < set(service.photos.root.iterdir())
    barrier = Barrier(2)

    def update(index):
        command = parameters(
            service, name=f"Synthetic concurrent {index}", expected_version=3
        )
        barrier.wait()
        try:
            return service.update_company(command, actor)["version"]
        except PaymentError as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(update, range(2))) == [4, 409]
    assert service.company()["version"] == 4


def test_ctr05_parameters_change_during_render_and_signature_storage_failure(contracts):
    service, actor, identifier, _ = contracts
    ready(contracts)
    original = service.renderer

    def concurrent_change(snapshot, *, draft):
        service.update_company(parameters(service, name="Changed during render"), actor)
        return original(snapshot, draft=draft)

    with patch.object(service, "renderer", concurrent_change):
        with pytest.raises(PaymentError) as error:
            service.issue(identifier, issue_command(contracts), actor)
    assert (
        error.value.status == 409 and service.versions(identifier, quotation=True) == []
    )
    issued = service.issue(identifier, issue_command(contracts), actor)
    baseline = set(service.photos.root.iterdir())
    with patch.object(Session, "commit", side_effect=RuntimeError("upload rollback")):
        with pytest.raises(RuntimeError):
            service.event(
                UUID(issued["contract_id"]),
                1,
                SignatureCommand(request_id=uuid4(), expected_contract_version=1),
                actor,
                (pdf(), "application/pdf"),
            )
    assert set(service.photos.root.iterdir()) == baseline
    with service.factory() as session:
        assert session.scalar(select(func.count()).select_from(ContractEvent)) == 0
        assert session.scalar(select(func.count()).select_from(ContractSeries)) == 1
        assert session.scalar(select(func.count()).select_from(ContractRequest)) == 3


def test_ctr03_current_signature_and_persisted_deposit_after_rental_change(
    migrated_engine, tmp_path
):
    changes = changes_fixture.__wrapped__(migrated_engine, tmp_path)
    rental = confirmed(changes)
    change_service, payments = changes
    storage = tmp_path / "contracts"
    storage.mkdir(mode=0o700)
    service = ContractService(
        change_service.factory,
        PhotoStorage(storage),
        clock=change_service.clock,
    )
    fixture = (service, payments[1], payments[2], payments[3])
    ready(fixture)
    issued = service.issue(payments[2], issue_command(fixture), payments[1])
    series = UUID(issued["contract_id"])
    service.event(
        series,
        1,
        SignatureCommand(
            request_id=uuid4(),
            expected_contract_version=1,
            reviewed=True,
            signed_date="2026-10-08",
            declaration="Conferência sintética explícita",
        ),
        payments[1],
        (image_bytes(), "image/png"),
    )
    assert service.signature_state(payments[2])["ready_for_pickup"] is True
    first_pdf = service.download(series, 1)[0]
    changed, _ = change_service.command(
        UUID(rental["id"]),
        "change",
        change_command(changes, rental, total=Decimal("500")),
        payments[1],
    )
    state = service.signature_state(payments[2])
    assert not state["matches_current_business"] and not state["ready_for_pickup"]
    second = service.issue(payments[2], issue_command(fixture), payments[1])
    assert second["signature_state"] == "pending" and second["number"] == 2
    with service.factory() as session:
        stored = session.get(ContractVersion, (series, 2)).snapshot
        assert (stored["total"], stored["deposit"], stored["balance"]) == (
            "500.00",
            "200.00",
            "300.00",
        )
        assert stored["received"] == "200.00" and stored["remaining"] == "300.00"
        assert stored["financial"] == changed["current_financial"]
    assert service.download(series, 1)[0] == first_pdf
    assert not service.signature_state(payments[2])["ready_for_pickup"]
