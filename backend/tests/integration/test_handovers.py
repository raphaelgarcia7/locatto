"""Real PostgreSQL custody, dated capacity, finance and concurrency regressions."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from threading import Barrier
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from rentalops_api.capacity import capacity_view
from rentalops_api.catalog_models import Product
from rentalops_api.catalog_storage import PhotoStorage
from rentalops_api.contract_contracts import SignatureCommand
from rentalops_api.contracts import ContractService
from rentalops_api.handover_contracts import (
    FinancialAgreementCommand,
    ForecastCommand,
    HandoverCommand,
    OperationalCommand,
    ResolutionCommand,
    ReturnCommand,
)
from rentalops_api.handover_models import Handover, IncidentResolution, ReturnEvent
from rentalops_api.handovers import HandoverService
from rentalops_api.rental_models import RentalAllocation
from rentalops_api.rentals import RentalError

from ..unit.test_contract_contracts import image_bytes
from .test_contracts import issue_command, ready
from .test_rental_changes import changes as changes_fixture
from .test_rental_changes import confirmed

pytestmark = pytest.mark.integration


@pytest.fixture
def custody(migrated_engine, tmp_path):
    changes = changes_fixture.__wrapped__(migrated_engine, tmp_path)
    rental = confirmed(changes)
    service = HandoverService(
        changes[0].factory, lambda: datetime(2026, 10, 8, 12, tzinfo=UTC)
    )
    storage = tmp_path / "custody-contracts"
    storage.mkdir(mode=0o700)
    contracts = ContractService(
        service.factory, PhotoStorage(storage), clock=service.clock
    )
    fixture = (contracts, changes[1][1], changes[1][2], changes[1][3])
    ready(fixture)
    issued = contracts.issue(fixture[2], issue_command(fixture), fixture[1])
    contracts.event(
        UUID(issued["contract_id"]),
        1,
        SignatureCommand(
            request_id=uuid4(),
            expected_contract_version=1,
            reviewed=True,
            signed_date="2026-10-08",
            declaration="Conferência sintética explícita",
        ),
        fixture[1],
        (image_bytes(), "image/png"),
    )
    return service, fixture[1], UUID(rental["id"]), contracts, changes


def command(custody, model=OperationalCommand, **fields):
    service, _, identifier, _, _ = custody
    current = service.get_operations(identifier)
    return model.model_validate(
        {
            "request_id": str(uuid4()),
            "reason": "Decisão sintética explícita da equipe",
            "expected_rental_version": current["rental_version"],
            "expected_quotation_version": current["quotation_version"],
            "expected_financial_version": current["financial_version"],
            "expected_contract_version": current["contract"]["version"],
            **fields,
        }
    )


def handover(custody, **fields):
    service, actor, identifier, _, _ = custody
    lines = service.get_operations(identifier)["lines"]
    payload = command(
        custody,
        HandoverCommand,
        lines=[
            {
                "product_id": line["product_id"],
                "quantity": line["quantity"],
                "condition": "Bom estado conferido",
            }
            for line in lines
        ],
        balance_exception="Saldo autorizado com dívida preservada",
        **fields,
    )
    return service.execute(identifier, "handover", payload, actor), payload


def receive(custody, lines, business_date="2026-10-08"):
    service, actor, identifier, _, _ = custody
    payload = command(custody, ReturnCommand, business_date=business_date, lines=lines)
    return service.execute(identifier, "return", payload, actor), payload


def resolve(custody, incident, disposition, quantity):
    service, actor, identifier, _, _ = custody
    payload = command(
        custody,
        ResolutionCommand,
        disposition=disposition,
        quantity=quantity,
        agreed=True,
    )
    return service.execute(
        identifier, "resolution", payload, actor, UUID(incident["id"])
    ), payload


def available(custody, product, day):
    service = custody[0]
    with service.factory() as session:
        row = session.get(Product, UUID(product))
        return capacity_view(
            session, {row.id: row}, {row.id: 0}, day, day, today=service.clock().date()
        )[0]["available"]


def test_ret01_signature_balance_versions_integral_third_party_and_replay(custody):
    service, actor, identifier, contracts, _ = custody
    _, payload = handover(custody)
    original = service.get_operations(identifier)
    assert original["state"] == "out" and original["financial"]["remaining"] == "200.00"
    assert original["handover"]["balance_exception"] and original["handover"][
        "actor_id"
    ] == str(actor.user_id)
    replay, repeated = service.execute(identifier, "handover", payload, actor)
    assert repeated and replay == original
    with pytest.raises(RentalError) as error:
        service.execute(
            identifier,
            "handover",
            payload.model_copy(update={"reason": "different"}),
            actor,
        )
    assert error.value.code == "idempotency_conflict"
    with service.factory() as session:
        assert session.scalar(select(func.count()).select_from(Handover)) == 1
        with pytest.raises(ProgrammingError):
            session.execute(text("UPDATE handovers SET lines = '[]'"))


def test_ret02_partial_fit_outstanding_capacity_next_day_and_validation(custody):
    service, actor, identifier, _, _ = custody
    state = handover(custody)[0][0]
    vase = next(line for line in state["lines"] if line["quantity"] == 5)
    received, payload = receive(
        custody, [{"product_id": vase["product_id"], "quantity": 3, "condition": "fit"}]
    )
    assert (
        next(
            line
            for line in received[0]["lines"]
            if line["product_id"] == vase["product_id"]
        )["outstanding"]
        == 2
    )
    assert available(custody, vase["product_id"], date(2026, 10, 8)) == 0
    assert available(custody, vase["product_id"], date(2026, 10, 9)) == 3
    assert service.execute(identifier, "return", payload, actor) == (received[0], True)
    for bad in (
        [{"product_id": vase["product_id"], "quantity": 3, "condition": "fit"}],
        [{"product_id": str(uuid4()), "quantity": 1, "condition": "fit"}],
    ):
        with pytest.raises(RentalError) as error:
            receive(custody, bad)
        assert error.value.status == 422
    with pytest.raises(RentalError):
        receive(
            custody,
            [{"product_id": vase["product_id"], "quantity": 1, "condition": "fit"}],
            "2026-10-09",
        )
    with pytest.raises(RentalError):
        receive(
            custody,
            [{"product_id": vase["product_id"], "quantity": 1, "condition": "fit"}],
            "2026-10-07",
        )
    assert service.get_operations(identifier)["state"] == "out"


def test_ret03_v2_close_requires_maintenance_decision_debt_persists_release_after_close(
    custody,
):
    service, actor, identifier, _, _ = custody
    state = handover(custody)[0][0]
    lines = [
        {
            "product_id": line["product_id"],
            "quantity": line["quantity"],
            "condition": "cleaning",
        }
        for line in state["lines"]
    ]
    receive(custody, lines)
    with pytest.raises(RentalError) as error:
        service.execute(identifier, "close", command(custody), actor)
    assert error.value.code == "operational_pending"
    for incident in service.get_operations(identifier)["incidents"]:
        if incident["kind"] == "cleaning":
            state = resolve(custody, incident, "maintenance", incident["quantity"])[0][
                0
            ]
            assert not state["financial"]["fully_paid"]
    payload = command(custody)
    closed, replay = service.execute(identifier, "close", payload, actor)
    assert (
        closed["state"] == "completed" and closed["financial"]["remaining"] == "200.00"
    )
    assert not replay and service.execute(identifier, "close", payload, actor) == (
        closed,
        True,
    )
    for incident in closed["incidents"]:
        if incident["kind"] == "cleaning":
            assert available(custody, incident["product_id"], date(2026, 10, 9)) == 0
            state, _ = resolve(custody, incident, "released", incident["quantity"])[0]
            assert state["state"] == "completed"
            assert available(custody, incident["product_id"], date(2026, 10, 8)) == 0
            assert (
                available(custody, incident["product_id"], date(2026, 10, 9))
                == incident["quantity"]
            )


def test_ret04_late_forecast_never_releases_stock_until_real_return(custody):
    service, actor, identifier, _, _ = custody
    handover(custody)
    service.clock = lambda: datetime(2026, 10, 20, 12, tzinfo=UTC)
    state, _ = service.execute(
        identifier,
        "forecast",
        command(custody, ForecastCommand, business_date="2026-10-21"),
        actor,
    )
    assert state["late"]
    for line in state["lines"]:
        assert available(custody, line["product_id"], date(2026, 11, 1)) == 0
    receive(
        custody,
        [
            {
                "product_id": line["product_id"],
                "quantity": line["quantity"],
                "condition": "fit",
            }
            for line in state["lines"]
        ],
        "2026-10-20",
    )
    for line in state["lines"]:
        assert (
            available(custody, line["product_id"], date(2026, 10, 21))
            == line["quantity"]
        )


def test_ret05_loss_atomic_no_fake_return_financial_manual_and_no_duplicate_damage(
    custody,
):
    service, actor, identifier, _, _ = custody
    state = handover(custody)[0][0]
    origin = next(row for row in state["incidents"] if row["quantity"] == 5)
    state = resolve(custody, origin, "lost", 2)[0][0]
    assert state["returns"] == [] and state["agreements"] == []
    line = next(
        row for row in state["lines"] if row["product_id"] == origin["product_id"]
    )
    assert (line["lost"], line["outstanding"]) == (2, 3)
    with service.factory() as session:
        product = session.get(Product, UUID(origin["product_id"]))
        assert product.total_quantity == 4
        assert session.get(RentalAllocation, (identifier, product.id)).quantity == 3
    state, _ = service.execute(
        identifier,
        "agreement",
        command(
            custody,
            FinancialAgreementCommand,
            kind="replacement",
            quantity=2,
            amount="50.00",
            agreed=True,
        ),
        actor,
        UUID(origin["id"]),
    )
    assert state["financial"]["extra_agreed"] == "50.00"
    assert state["financial"]["operational_debt"] == "250.00"
    assert (
        state["financial"]["received"] == "200.00"
        and state["financial"]["refunded"] == "0.00"
    )
    history = service.payments.history(UUID(state["financial"]["quotation_id"]))
    agreement_event = next(
        event
        for event in history["items"]
        if event["operation"] == "incident_agreement"
    )
    assert agreement_event["before"]["operational_debt"] == "200.00"
    assert agreement_event["after"] == state["financial"]
    assert agreement_event["after"]["receipts"] == agreement_event["before"]["receipts"]


def test_ret06_two_attendants_same_key_rollback_and_stale_version(custody):
    service, actor, identifier, _, _ = custody
    state = handover(custody)[0][0]
    line = state["lines"][0]
    payload = command(
        custody,
        ReturnCommand,
        business_date="2026-10-08",
        lines=[
            {"product_id": line["product_id"], "quantity": 1, "condition": "damaged"}
        ],
    )
    barrier = Barrier(2)

    def execute(body):
        barrier.wait()
        try:
            return service.execute(identifier, "return", body, actor)
        except RentalError as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(execute, [payload, payload]))
    assert results[0][0] == results[1][0] and sorted(row[1] for row in results) == [
        False,
        True,
    ]
    with pytest.raises(RentalError) as error:
        service.execute(
            identifier,
            "return",
            payload.model_copy(update={"request_id": uuid4()}),
            actor,
        )
    assert error.value.status == 409
    before = service.get_operations(identifier)
    with patch.object(
        Session, "commit", side_effect=RuntimeError("before commit fault")
    ):
        with pytest.raises(RuntimeError):
            receive(
                custody,
                [
                    {
                        "product_id": line["product_id"],
                        "quantity": 1,
                        "condition": "damaged",
                    }
                ],
            )
    assert service.get_operations(identifier) == before
    with service.factory() as session:
        assert session.scalar(select(func.count()).select_from(ReturnEvent)) == 1
        assert session.scalar(select(func.count()).select_from(IncidentResolution)) == 0


@pytest.mark.parametrize(
    "real_date,clock,next_day",
    [
        ("2026-10-10", datetime(2026, 10, 10, 12, tzinfo=UTC), date(2026, 10, 11)),
        ("2026-10-11", datetime(2026, 10, 11, 12, tzinfo=UTC), date(2026, 10, 12)),
        ("2026-10-12", datetime(2026, 10, 12, 12, tzinfo=UTC), date(2026, 10, 13)),
        ("2026-10-31", datetime(2026, 11, 1, 2, 59, tzinfo=UTC), date(2026, 11, 1)),
        ("2026-12-31", datetime(2027, 1, 1, 2, 59, tzinfo=UTC), date(2027, 1, 1)),
    ],
)
def test_ret03_real_calendar_next_day_early_weekend_holiday_month_year_and_timezone(
    custody, real_date, clock, next_day
):
    state = handover(custody)[0][0]
    custody[0].clock = lambda: clock
    receive(
        custody,
        [
            {
                "product_id": row["product_id"],
                "quantity": row["quantity"],
                "condition": "fit",
            }
            for row in state["lines"]
        ],
        real_date,
    )
    for row in state["lines"]:
        assert available(custody, row["product_id"], date.fromisoformat(real_date)) == 0
        assert available(custody, row["product_id"], next_day) == row["quantity"]


def test_ret01_missing_contract_and_earlier_signature_never_bypass_financial_exception(
    custody,
):
    service, actor, identifier, contracts, changes = custody
    state = service.get_operations(identifier)
    payload = command(
        custody,
        HandoverCommand,
        lines=[
            {
                "product_id": row["product_id"],
                "quantity": row["quantity"],
                "condition": "Conferido",
            }
            for row in state["lines"]
        ],
    )
    with pytest.raises(RentalError) as error:
        service.execute(identifier, "handover", payload, actor)
    assert error.value.code == "balance_required"
    incomplete = payload.model_copy(
        update={"lines": payload.lines[:-1], "balance_exception": "Exceção"}
    )
    with pytest.raises(RentalError) as error:
        service.execute(identifier, "handover", incomplete, actor)
    assert error.value.code == "integral_handover"
    fixture = (contracts, actor, changes[1][2], changes[1][3])
    issued = contracts.issue(fixture[2], issue_command(fixture), actor)
    assert issued["number"] == 2 and issued["signature_state"] == "pending"
    stale = payload.model_copy(update={"balance_exception": "Exceção"})
    with pytest.raises(RentalError) as error:
        service.execute(identifier, "handover", stale, actor)
    assert error.value.code == "version_conflict"
    pending = stale.model_copy(update={"expected_contract_version": 2})
    with pytest.raises(RentalError) as error:
        service.execute(identifier, "handover", pending, actor)
    assert error.value.code == "signature_required"
    assert service.get_operations(identifier)["handover"] is None
    # A separate confirmed business record without any series fails the same gate.
    from .test_payments import allocation, reconcile
    from .test_payments import receive as money_receive
    from .test_quotations import create
    from .test_rentals import confirmation

    with service.factory.begin() as session:
        for row in session.scalars(select(Product)):
            row.total_quantity += 10
    quote = create(changes[1][3])
    payments = (*changes[1][:2], UUID(quote["id"]), changes[1][3], quote)
    received = money_receive(payments)
    reconcile(payments, [allocation(received)])
    confirmed_rental = changes[0].confirm(payments[2], confirmation(payments), actor)[0]
    no_contract = (service, actor, UUID(confirmed_rental["id"]), contracts, changes)
    state = service.get_operations(no_contract[2])
    body = command(
        no_contract,
        HandoverCommand,
        lines=[
            {
                "product_id": row["product_id"],
                "quantity": row["quantity"],
                "condition": "Conferido",
            }
            for row in state["lines"]
        ],
        balance_exception="Exceção",
    )
    with pytest.raises(RentalError) as error:
        service.execute(no_contract[2], "handover", body, actor)
    assert error.value.code == "signature_required"


def test_ret06_unknown_commit_ack_replay_and_v2_maintenance_close_rollback(custody):
    service, actor, identifier, _, _ = custody
    state = handover(custody)[0][0]
    receive(
        custody,
        [
            {
                "product_id": row["product_id"],
                "quantity": row["quantity"],
                "condition": "damaged",
            }
            for row in state["lines"]
        ],
    )
    for incident in service.get_operations(identifier)["incidents"]:
        if incident["kind"] == "damaged":
            resolve(custody, incident, "maintenance", incident["quantity"])
    before = service.get_operations(identifier)
    payload = command(custody)
    with patch.object(Session, "commit", side_effect=RuntimeError("close rollback")):
        with pytest.raises(RuntimeError):
            service.execute(identifier, "close", payload, actor)
    assert service.get_operations(identifier) == before
    original_commit = Session.commit

    def lost_ack(session):
        original_commit(session)
        raise RuntimeError("lost close acknowledgement")

    with patch.object(Session, "commit", lost_ack):
        with pytest.raises(RuntimeError):
            service.execute(identifier, "close", payload, actor)
    replay, repeated = service.execute(identifier, "close", payload, actor)
    assert repeated and replay["state"] == "completed"
    for row in replay["lines"]:
        assert available(custody, row["product_id"], date(2026, 10, 14)) == 0


def another_rental(custody, **draft):
    from .test_payments import allocation, reconcile
    from .test_payments import receive as money_receive
    from .test_quotations import create
    from .test_rentals import confirmation

    service, actor, _, contracts, changes = custody
    quote = create(changes[1][3], **draft)
    payments = (*changes[1][:2], UUID(quote["id"]), changes[1][3], quote)
    received = money_receive(payments, quote["estimated_deposit"])
    reconcile(payments, [allocation(received, deposit=quote["estimated_deposit"])])
    rental = changes[0].confirm(payments[2], confirmation(payments), actor)[0]
    return service, actor, UUID(rental["id"]), contracts, (changes[0], payments)


def pending_rental(custody, **draft):
    from .test_payments import allocation, reconcile
    from .test_payments import receive as money_receive
    from .test_quotations import create

    changes = custody[4]
    quote = create(changes[1][3], **draft)
    payments = (*changes[1][:2], UUID(quote["id"]), changes[1][3], quote)
    received = money_receive(payments, quote["estimated_deposit"])
    reconcile(payments, [allocation(received, deposit=quote["estimated_deposit"])])
    return payments


def sign(custody):
    _, actor, _, contracts, changes = custody
    fixture = (contracts, actor, changes[1][2], changes[1][3])
    items = [
        {"product_id": row["product_id"], "condition": "Conferido"}
        for row in custody[0].get_operations(custody[2])["lines"]
    ]
    issued = contracts.issue(fixture[2], issue_command(fixture, items=items), actor)
    contracts.event(
        UUID(issued["contract_id"]),
        issued["number"],
        SignatureCommand(
            request_id=uuid4(),
            expected_contract_version=issued["number"],
            reviewed=True,
            signed_date="2026-10-08",
            declaration="Conferência sintética explícita",
        ),
        actor,
        (image_bytes(), "image/png"),
    )


def test_r08_ret_ten_sent_eight_fit_two_missing_then_cleaning_not_double_counted(
    custody,
):
    service, actor, _, _, changes = custody
    from .test_rental_changes import cancel

    cancel(changes, service.get(custody[2]))
    pid = changes[1][3][2]["vase"]
    with service.factory.begin() as session:
        product = session.get(Product, pid)
        product.total_quantity = 10
        product.maintenance_quantity = 0
    case = another_rental(
        custody, lines=[{"kind": "product", "source_id": str(pid), "quantity": 10}]
    )
    sign(case)
    handover(case)
    service.clock = lambda: datetime(2026, 10, 13, 12, tzinfo=UTC)
    state = receive(
        case,
        [{"product_id": str(pid), "quantity": 8, "condition": "fit"}],
        "2026-10-13",
    )[0][0]
    assert state["lines"][0]["outstanding"] == 2
    # Precisely the eight actually received units are reusable on Oct14.
    assert available(case, str(pid), date(2026, 10, 13)) == 0
    assert available(case, str(pid), date(2026, 10, 14)) == 8
    service.clock = lambda: datetime(2026, 10, 14, 12, tzinfo=UTC)
    assert available(case, str(pid), date(2026, 10, 14)) == 8  # two late stay blocked
    receive(
        case,
        [{"product_id": str(pid), "quantity": 2, "condition": "cleaning"}],
        "2026-10-14",
    )
    assert available(case, str(pid), date(2026, 10, 15)) == 8
    incident = next(
        row
        for row in service.get_operations(case[2])["incidents"]
        if row["kind"] == "cleaning"
    )
    resolve(case, incident, "maintenance", 1)
    with pytest.raises(RentalError):
        service.execute(case[2], "close", command(case), actor)
    resolve(case, incident, "released", 1)
    state = service.get_operations(case[2])
    assert state[
        "can_close"
    ]  # one physically released and one explicitly in maintenance
    service.execute(case[2], "close", command(case), actor)
    assert available(case, str(pid), date(2026, 10, 14)) == 8
    assert available(case, str(pid), date(2026, 10, 15)) == 9
    resolve(case, incident, "released", 1)
    assert available(case, str(pid), date(2026, 10, 15)) == 10
    with pytest.raises(RentalError):
        resolve(case, incident, "released", 1)


def test_r11_ret_actual_out_cancel_extension_partial_and_completed_copy(custody):
    from rentalops_api.quotation_contracts import QuotationDraft

    from .test_quotations import command_for
    from .test_rental_changes import cancel, change_command

    service, actor, identifier, _, changes = custody
    state = handover(custody)[0][0]
    original_snapshot = service.get(identifier)["commercial_snapshot"]
    with pytest.raises(RentalError) as failure:
        cancel(changes, service.get(identifier))
    assert failure.value.code == "already_out"
    vase = next(row for row in state["lines"] if row["quantity"] == 5)
    receive(
        custody, [{"product_id": vase["product_id"], "quantity": 3, "condition": "fit"}]
    )
    extended, _ = changes[0].command(
        identifier,
        "change",
        change_command(changes, service.get(identifier), return_date="2026-10-15"),
        actor,
    )
    assert (
        next(
            row
            for row in extended["allocations"]
            if row["product_id"] == vase["product_id"]
        )["quantity"]
        == 2
    )
    assert [
        {key: value for key, value in row.items() if key != "id"}
        for row in extended["commercial_snapshot"]["lines"]
    ] == [
        {key: value for key, value in row.items() if key != "id"}
        for row in original_snapshot["lines"]
    ]
    state = service.get_operations(identifier)
    receive(
        custody,
        [
            {
                "product_id": row["product_id"],
                "quantity": row["outstanding"],
                "condition": "fit",
            }
            for row in state["lines"]
            if row["outstanding"]
        ],
    )
    service.execute(identifier, "close", command(custody), actor)
    reference = changes[0].copy_preview(identifier, command(custody))
    assert reference["payments_transferred"] == "0.00"
    new, _ = changes[1][3][0].write(
        command_for(
            changes[1][3][0], QuotationDraft.model_validate(reference["draft"])
        ),
        actor,
    )
    assert new["id"] != str(changes[1][2])
    assert changes[1][0].get(UUID(new["id"]))["received"] == "0.00"
    assert changes[1][0].get(changes[1][2])["received"] == "200.00"
    assert (
        service.history(identifier)["items"][0]["after"]["commercial"]["lines"]
        == original_snapshot["lines"]
    )


def test_ret06_distinct_attendants_cannot_double_return_or_maintenance_decision(
    custody,
):
    from dataclasses import replace
    from datetime import timedelta

    from rentalops_api.models import AuthSession, User

    service, actor, identifier, _, _ = custody
    with service.factory.begin() as session:
        user = User(email="synthetic-second-attendant@example.invalid")
        session.add(user)
        session.flush()
        auth = AuthSession(
            user_id=user.id,
            token_hash=uuid4().hex,
            created_at=service.clock(),
            last_activity=service.clock(),
            expires_at=service.clock() + timedelta(hours=12),
        )
        session.add(auth)
        session.flush()
        second = replace(actor, user_id=user.id, session_id=auth.id)
    actors = [actor, second]
    state = handover(custody)[0][0]
    line = state["lines"][0]
    body = command(
        custody,
        ReturnCommand,
        business_date="2026-10-08",
        lines=[
            {"product_id": line["product_id"], "quantity": 1, "condition": "damaged"}
        ],
    )
    barrier = Barrier(2)

    def run(index):
        barrier.wait()
        try:
            return service.execute(
                identifier,
                "return",
                body.model_copy(update={"request_id": uuid4()}),
                actors[index],
                None,
            )[0]
        except RentalError as error:
            return error.code

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(row, dict) for row in results) == 1
    assert "version_conflict" in results
    incident = next(
        row
        for row in service.get_operations(identifier)["incidents"]
        if row["kind"] == "damaged"
    )
    body = command(
        custody, ResolutionCommand, disposition="maintenance", quantity=1, agreed=True
    )
    barrier = Barrier(2)

    def decide(index):
        barrier.wait()
        try:
            return service.execute(
                identifier,
                "resolution",
                body.model_copy(update={"request_id": uuid4()}),
                actors[index],
                UUID(incident["id"]),
            )[0]
        except RentalError as error:
            return error.code

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(decide, range(2)))
    assert sum(isinstance(row, dict) for row in results) == 1
    assert "version_conflict" in results
    with pytest.raises(RentalError):
        resolve(custody, incident, "maintenance", 1)


def test_ret05_loss_rollback_damage_repair_replacement_guard_and_migration_preservation(
    custody,
):
    from alembic import command as migration

    from ..conftest import migration_config

    service, actor, identifier, _, _ = custody
    state = handover(custody)[0][0]
    vase = next(row for row in state["lines"] if row["quantity"] == 5)
    receive(
        custody,
        [{"product_id": vase["product_id"], "quantity": 2, "condition": "damaged"}],
    )
    incident = next(
        row
        for row in service.get_operations(identifier)["incidents"]
        if row["kind"] == "damaged"
    )
    state, _ = service.execute(
        identifier,
        "agreement",
        command(
            custody,
            FinancialAgreementCommand,
            kind="repair",
            quantity=1,
            amount="20.00",
            agreed=True,
        ),
        actor,
        UUID(incident["id"]),
    )
    before = service.get_operations(identifier)
    with pytest.raises(RentalError):
        resolve(custody, incident, "lost", 2)
    with patch.object(Session, "commit", side_effect=RuntimeError("loss rollback")):
        with pytest.raises(RuntimeError):
            resolve(custody, incident, "lost", 1)
    assert service.get_operations(identifier) == before
    resolve(custody, incident, "lost", 1)
    service.execute(
        identifier,
        "agreement",
        command(
            custody,
            FinancialAgreementCommand,
            kind="replacement",
            quantity=1,
            amount="35.00",
            agreed=True,
        ),
        actor,
        UUID(incident["id"]),
    )
    with pytest.raises(RentalError):
        service.execute(
            identifier,
            "agreement",
            command(
                custody,
                FinancialAgreementCommand,
                kind="repair",
                quantity=1,
                amount="20.00",
                agreed=True,
            ),
            actor,
            UUID(incident["id"]),
        )
    assert service.get_operations(identifier)["financial"]["extra_agreed"] == "55.00"
    with pytest.raises(ProgrammingError):
        with service.factory.begin() as session:
            migration.downgrade(
                migration_config(session.connection()), "0010_contracts"
            )
    assert service.get_operations(identifier)["handover"] == state["handover"]


def test_r11_ret_concurrent_last_unit_return_and_new_confirmation(custody):
    from .test_rentals import confirmation

    service, actor, identifier, _, changes = custody
    state = handover(custody)[0][0]
    vase = next(row for row in state["lines"] if row["quantity"] == 5)
    future = pending_rental(
        custody,
        lines=[{"kind": "product", "source_id": vase["product_id"], "quantity": 1}],
        pickup_date="2026-10-10",
        event_date="2026-10-10",
        return_date="2026-10-10",
    )
    body = command(
        custody,
        ReturnCommand,
        business_date="2026-10-08",
        lines=[{"product_id": vase["product_id"], "quantity": 1, "condition": "fit"}],
    )
    confirm_body = confirmation(future)
    barrier = Barrier(2)

    def run(operation):
        barrier.wait()
        try:
            if operation == "return":
                return service.execute(identifier, "return", body, actor)[0]
            return changes[0].confirm(future[2], confirm_body, actor)[0]
        except RentalError as error:
            return error.code

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(run, ["return", "confirm"]))
    assert isinstance(results[0], dict)
    if isinstance(results[1], str):
        assert results[1] == "capacity_conflict"
        result = changes[0].confirm(future[2], confirmation(future), actor)[0]
    else:
        result = results[1]
    assert result["state"] == "confirmed" and result["allocations"][0]["quantity"] == 1
    assert available(custody, vase["product_id"], date(2026, 10, 10)) == 0
    assert (
        service.get_operations(identifier)["lines"][
            next(
                index
                for index, row in enumerate(state["lines"])
                if row["product_id"] == vase["product_id"]
            )
        ]["outstanding"]
        == 4
    )


def test_r11_late_conflict_visible_without_cancel_and_stock_adjustment_race(custody):
    from rentalops_api.catalog import CatalogService
    from rentalops_api.catalog_contracts import StockAdjustment

    from .test_rentals import confirmation

    service, actor, identifier, contracts, changes = custody
    state = handover(custody)[0][0]
    vase = next(row for row in state["lines"] if row["quantity"] == 5)
    future = pending_rental(
        custody,
        lines=[{"kind": "product", "source_id": vase["product_id"], "quantity": 1}],
        pickup_date="2026-10-14",
        event_date="2026-10-14",
        return_date="2026-10-15",
    )
    reserved = changes[0].confirm(future[2], confirmation(future), actor)[0]
    service.clock = lambda: datetime(2026, 10, 14, 12, tzinfo=UTC)
    changes[1][3][0].clock = service.clock
    view = changes[1][3][0].get(future[2])
    assert view["stock_pending"] and view["rental"]["inventory_pending"]
    assert changes[0].get(UUID(reserved["id"]))["state"] == "confirmed"
    assert view["capacity"][0]["shortage"] == 1
    catalog = CatalogService(service.factory, contracts.photos)
    with service.factory() as session:
        version = session.get(Product, UUID(vase["product_id"])).version
    body = command(
        custody,
        ReturnCommand,
        business_date="2026-10-14",
        lines=[{"product_id": vase["product_id"], "quantity": 1, "condition": "fit"}],
    )
    adjustment = StockAdjustment(
        expected_version=version,
        quantity=1,
        operation="withdrawal",
        reason="Baixa sintética explícita",
    )
    barrier = Barrier(2)

    def run(operation):
        barrier.wait()
        if operation == "return":
            return service.execute(identifier, "return", body, actor)[0]
        return catalog.adjust_stock(UUID(vase["product_id"]), adjustment, actor)

    with ThreadPoolExecutor(2) as pool:
        list(pool.map(run, ["return", "adjust"]))
    after = changes[0].get(UUID(reserved["id"]))
    assert after["state"] == "confirmed" and after["inventory_pending"]
    assert after["allocations"] == reserved["allocations"]
    assert changes[1][3][0].get(future[2])["stock_pending"]
    assert service.get_operations(identifier)["financial"]["extra_agreed"] == "0.00"


@pytest.mark.parametrize("concurrent", ["contract", "payment"])
def test_ret01_contract_finance_race_reads_locked_versions_no_signature_bypass(
    custody, concurrent
):
    from rentalops_api.payment_contracts import CorrectionCommand
    from rentalops_api.payment_errors import PaymentError

    from .test_payments import versions

    service, actor, identifier, contracts, changes = custody
    current = service.get_operations(identifier)
    pickup = command(
        custody,
        HandoverCommand,
        balance_exception="Exceção sintética",
        lines=[
            {
                "product_id": row["product_id"],
                "quantity": row["quantity"],
                "condition": "Conferido",
            }
            for row in current["lines"]
        ],
    )
    contract_body = issue_command((contracts, actor, changes[1][2], changes[1][3]))
    payment_body = CorrectionCommand.model_validate(
        versions(
            changes[1][0],
            changes[1][2],
            amount="180.00",
            method="pix",
            business_date="2026-10-08",
            reason="Correção sintética explícita",
        )
    )
    receipt_id = UUID(current["financial"]["receipts"][0]["id"])
    barrier = Barrier(2)

    def run(operation):
        barrier.wait()
        try:
            if operation == "handover":
                return service.execute(identifier, "handover", pickup, actor)[0]
            if concurrent == "contract":
                return contracts.issue(changes[1][2], contract_body, actor)
            return changes[1][0].write(
                changes[1][2], "correction", payment_body, actor, receipt_id=receipt_id
            )
        except (RentalError, PaymentError) as error:
            return error.code

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(run, ["handover", "other"]))
    after = service.get_operations(identifier)
    if isinstance(results[0], str):
        assert results[0] == "version_conflict"
        assert after["state"] == "confirmed" and after["handover"] is None
    else:
        assert results[0]["state"] == "out"
        assert results[0]["contract"]["version"] == 1
        assert results[0]["handover"]["contract_version"] == 1
        assert results[0]["financial"]["received"] == "200.00"
    if concurrent == "contract":
        assert sum(isinstance(row, str) for row in results) == 1
    else:
        assert after["financial"]["received"] == "180.00"
        # #12 corrections invalidate applications; receipt money is preserved,
        # never silently reapplied or treated as a validated deposit.
        assert after["financial"]["operational_debt"] == "400.00"
        assert after["financial"]["pending"] == "180.00"
        assert after["financial"]["requires_reconciliation"]
        assert not after["financial"]["deposit_validated"]
