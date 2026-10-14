"""Dashboard checks use persisted predecessor modules and real PostgreSQL."""

from datetime import UTC, date, datetime
from decimal import Decimal
from time import monotonic
from uuid import UUID, uuid4

import pytest
from alembic import command as migration
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import event, select, text

from rentalops_api.dashboard import DashboardService
from rentalops_api.dashboard_contracts import (
    CalendarQuery,
    DayQuery,
    DayView,
    UpcomingQuery,
)
from rentalops_api.handover_contracts import (
    FinancialAgreementCommand,
    ForecastCommand,
    OperationalCommand,
)
from rentalops_api.models import Base
from rentalops_api.payment_contracts import CorrectionCommand
from rentalops_api.quotation_models import Quotation, QuotationVersion
from rentalops_api.rental_models import Rental

from ..conftest import migration_config
from .test_handovers import command, handover, receive, resolve
from .test_handovers import custody as custody_fixture
from .test_payments import allocation, reconcile, versions
from .test_payments import receive as receive_money
from .test_quotations import create
from .test_rental_changes import cancel, resume_command

pytestmark = pytest.mark.integration


@pytest.fixture
def dashboard_fixture(migrated_engine, tmp_path):
    custody = custody_fixture.__wrapped__(migrated_engine, tmp_path)
    dashboard = DashboardService(custody[0].factory, custody[0].clock)
    return dashboard, custody


def test_dash01_real_rental_queues_debt_completed_incidents_and_no_quotations(
    dashboard_fixture,
):
    dashboard, custody = dashboard_fixture
    service, actor, identifier, _, changes = custody
    # Persist an additional commercial quotation: it must never become an event.
    create(changes[1][3])
    day = DayView.model_validate(dashboard.day(DayQuery(date="2026-10-10")))
    assert day.queues["pickup"].total == 1
    assert day.queues["return"].total == 0
    row = day.queues["pickup"].items[0]
    assert row.rental_id == identifier and row.customer_display_name
    assert row.financial_summary.operational_debt == "200.00"
    assert row.operational_state == "confirmed" and row.actual_pickup_date is None
    handed = handover(custody)[0][0]
    lines = [
        {
            "product_id": item["product_id"],
            "quantity": item["quantity"],
            "condition": "damaged",
        }
        for item in handed["lines"]
    ]
    receive(custody, lines)
    current = service.get_operations(identifier)
    incident = next(item for item in current["incidents"] if item["kind"] == "damaged")
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
    value = dashboard.day(DayQuery(date="2026-10-14"))
    assert value["queues"]["occurrence"]["total"] == 1
    assert value["queues"]["overdue"]["total"] == 0
    for item in current["incidents"]:
        if item["kind"] == "damaged":
            resolve(custody, item, "maintenance", item["quantity"])
    service.execute(identifier, "close", command(custody, OperationalCommand), actor)
    value = dashboard.day(DayQuery(date="2026-10-14"))
    debt = value["queues"]["debt"]["items"][0]
    assert debt["operational_state"] == "completed"
    expected = service.get_operations(identifier)["financial"]
    assert (
        debt["financial_summary"]["operational_debt"]
        == expected["operational_debt"]
        == "220.00"
    )
    assert value["queues"]["pickup"]["total"] == value["queues"]["return"]["total"] == 0
    assert value["queues"]["occurrence"]["total"] == 0
    assert debt["actual_pickup_date"] == date(2026, 10, 8)
    assert debt["last_actual_return_date"] == date(2026, 10, 8)


def test_dash02_timezone_calendar_forecast_and_outstanding_still_late(
    dashboard_fixture,
):
    dashboard, custody = dashboard_fixture
    service, actor, identifier, _, _ = custody
    dashboard.clock = lambda: datetime(2026, 10, 11, 2, 59, tzinfo=UTC)
    assert dashboard.day(DayQuery())["date"] == date(2026, 10, 10)
    dashboard.clock = lambda: datetime(2026, 10, 11, 3, tzinfo=UTC)
    assert dashboard.day(DayQuery())["date"] == date(2026, 10, 11)
    state = handover(custody)[0][0]
    item = next(row for row in state["lines"] if row["quantity"] == 5)
    receive(
        custody, [{"product_id": item["product_id"], "quantity": 3, "condition": "fit"}]
    )
    service.execute(
        identifier,
        "forecast",
        command(custody, ForecastCommand, business_date="2026-11-02"),
        actor,
    )
    late = dashboard.day(DayQuery(date="2026-10-14"))["queues"]["overdue"]
    assert late["total"] == 1 and late["items"][0]["outstanding_qty"] == 4
    assert late["items"][0]["current_return_forecast"] == date(2026, 11, 2)
    month = dashboard.calendar(CalendarQuery(month="2026-11"))
    assert month["days"][1]["returns"] == 1
    upcoming = dashboard.upcoming(
        UpcomingQuery.model_validate({"from": "2026-11-01", "to": "2026-11-30"})
    )
    assert upcoming["total"] == 1 and upcoming["items"][0]["date"] == date(2026, 11, 2)
    assert upcoming["items"][0]["optional_time"] is None
    assert dashboard.day(DayQuery(date="2026-11-02"))["queues"]["return"]["total"] == 1
    for month, count in (
        ("2024-02", 29),
        ("2026-02", 28),
        ("2026-12", 31),
        ("2027-01", 31),
    ):
        result = dashboard.calendar(CalendarQuery(month=month))
        assert len(result["days"]) == count


def test_dash01_financial_summary_matches_payment_authority_after_current_revision(
    dashboard_fixture,
):
    dashboard, custody = dashboard_fixture
    _, actor, _, _, changes = custody
    payments = changes[1]
    service, _, quotation_id, *_ = payments

    def compare():
        expected = service.get(quotation_id)
        row = dashboard.day(DayQuery(date="2026-10-10"))["queues"]["pickup"]["items"][0]
        summary = row["financial_summary"]
        for name in (
            "remaining",
            "extra_agreed",
            "operational_debt",
            "requires_reconciliation",
        ):
            assert summary[name] == expected[name]
        assert summary["unallocated_received"] == expected["pending"]
        assert summary["pending"] == (
            Decimal(expected["operational_debt"]) > 0
            or expected["requires_reconciliation"]
        )
        return expected

    compare()
    received = receive_money(payments, "200.00")
    compare()  # A receipt without application is not a paid balance.
    reconcile(
        payments,
        [
            allocation(received),
            allocation(received, index=1, deposit="0.00", balance="200.00"),
        ],
    )
    assert compare()["operational_debt"] == "0.00"
    receipt = UUID(received["receipts"][1]["id"])
    service.write(
        quotation_id,
        "correction",
        CorrectionCommand.model_validate(
            versions(
                service,
                quotation_id,
                amount="100.00",
                method="cash",
                business_date="2026-10-08",
                reason="Synthetic corrected receipt",
            )
        ),
        actor,
        receipt,
    )
    assert compare()["requires_reconciliation"]


def test_dash01_formal_outstanding_loss_removes_only_decided_units(dashboard_fixture):
    dashboard, custody = dashboard_fixture
    service, _, identifier, _, _ = custody
    state = handover(custody)[0][0]
    item = next(row for row in state["lines"] if row["quantity"] == 5)
    receive(
        custody, [{"product_id": item["product_id"], "quantity": 3, "condition": "fit"}]
    )
    current = service.get_operations(identifier)
    incident = next(
        row
        for row in current["incidents"]
        if row["kind"] == "outstanding" and row["product_id"] == item["product_id"]
    )
    resolve(custody, incident, "lost", 1)
    result = dashboard.day(DayQuery(date="2026-10-14"))
    row = result["queues"]["overdue"]["items"][0]
    actual = service.get_operations(identifier)
    assert (
        row["outstanding_qty"]
        == sum(line["outstanding"] for line in actual["lines"])
        == 3
    )
    assert row["occurrence_count"] == sum(
        item["remaining"]
        > (0 if item["kind"] == "outstanding" else item["maintenance_decided"])
        for item in actual["incidents"]
    )


def test_dash01_cancelled_and_review_debt_is_not_confirmed_schedule(dashboard_fixture):
    dashboard, custody = dashboard_fixture
    _, actor, identifier, _, changes = custody
    service, payments = changes
    cancelled = cancel(changes, service.get(identifier))

    def compare(state):
        query = DayQuery(date="2026-10-10", operational_state=state)
        queues = dashboard.day(query)["queues"]
        assert queues["pickup"]["total"] == queues["return"]["total"] == 0
        assert queues["debt"]["total"] == 1
        assert queues["debt"]["items"][0]["operational_state"] == state
        assert dashboard.upcoming(UpcomingQuery(operational_state=state))["total"] == 0
        month = dashboard.calendar(
            CalendarQuery(month="2026-10", operational_state=state)
        )
        assert all(day["pickup"] == day["returns"] == 0 for day in month["days"])

    compare("cancelled")
    service.command(
        identifier,
        "resume",
        resume_command(changes, cancelled, [allocation(payments[0].get(payments[2]))]),
        actor,
    )
    compare("review")


def test_dash03_volume_2000_pagination_filters_order_and_bounded_queries(
    dashboard_fixture, migrated_engine, record_property
):
    dashboard, custody = dashboard_fixture
    service, _, identifier, _, _ = custody
    with service.factory.begin() as session:
        original = session.get(Rental, identifier)
        header = session.get(Quotation, original.quotation_id)
        offer = session.get(QuotationVersion, (header.id, header.current_version))
        customer = header.customer_id
        for index in range(1999):
            qid = uuid4()
            session.add(
                Quotation(
                    id=qid,
                    customer_id=customer,
                    current_version=1,
                    created_at=header.created_at,
                )
            )
            snapshot = dict(offer.snapshot)
            snapshot["pickup_time"] = "10:00" if index % 2 else None
            session.add(
                QuotationVersion(
                    quotation_id=qid,
                    number=1,
                    pickup_date=offer.pickup_date,
                    event_date=offer.event_date,
                    return_date=offer.return_date,
                    valid_until=offer.valid_until,
                    subtotal=offer.subtotal,
                    discount_amount=offer.discount_amount,
                    total=offer.total,
                    estimated_deposit=offer.estimated_deposit,
                    estimated_balance=offer.estimated_balance,
                    snapshot=snapshot,
                    actor_id=original.actor_id,
                    session_id=original.session_id,
                )
            )
            session.add(
                Rental(
                    quotation_id=qid,
                    quotation_version=1,
                    confirmation_deposit=Decimal("200.00"),
                    commercial_snapshot=snapshot,
                    financial_snapshot={},
                    actor_id=original.actor_id,
                    session_id=original.session_id,
                    checked_at=original.checked_at,
                )
            )
    statements = []

    def count_sql(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(migrated_engine, "before_cursor_execute", count_sql)
    try:
        started = monotonic()
        first = dashboard.day(DayQuery(date="2026-10-10", page_size=100))
        elapsed = monotonic() - started
        assert (
            len(statements) == 11
        )  # SET + two bounded queries per queue, not per record.
        assert first["queues"]["pickup"]["total"] == 2000
        assert len(first["queues"]["pickup"]["items"]) == 100
        assert all(
            "photo" not in sql and "contract_versions" not in sql for sql in statements
        )
        record_property("volume_rentals", 2000)
        record_property("day_query_count", len(statements))
        record_property("day_elapsed_seconds", round(elapsed, 4))
        seen = []
        times = []
        for page in range(1, 21):
            value = dashboard.upcoming(
                UpcomingQuery.model_validate(
                    {
                        "from": "2026-10-10",
                        "to": "2026-10-10",
                        "page": page,
                        "page_size": 100,
                        "operational_state": "confirmed",
                        "financial_pending": True,
                        "customer_id": str(customer),
                    }
                )
            )
            assert value["total"] == 2000
            seen.extend(item["rental_id"] for item in value["items"])
            times.extend(item["optional_time"] for item in value["items"])
        assert len(seen) == len(set(seen)) == 2000
        assert seen == [
            item["rental_id"]
            for page in range(1, 21)
            for item in dashboard.upcoming(
                UpcomingQuery.model_validate(
                    {
                        "from": "2026-10-10",
                        "to": "2026-10-10",
                        "page": page,
                        "page_size": 100,
                    }
                )
            )["items"]
        ]
        assert times == sorted(times, key=lambda value: (value is None, value or ""))
        month = dashboard.calendar(CalendarQuery(month="2026-10"))
        assert month["days"][9]["pickup"] == month["days"][12]["returns"] == 2000
        assert (
            dashboard.day(DayQuery(customer_id=uuid4()))["queues"]["debt"]["total"] == 0
        )
        assert dashboard.upcoming(UpcomingQuery(financial_pending=False))["total"] == 0
    finally:
        event.remove(migrated_engine, "before_cursor_execute", count_sql)


def test_dash02_snapshot_repeatable_read_readonly_and_migration_preserves_data(
    dashboard_fixture, migrated_engine
):
    dashboard, custody = dashboard_fixture
    _, _, identifier, _, _ = custody
    with dashboard.snapshot() as session:
        assert session.scalar(text("SHOW transaction_isolation")) == "repeatable read"
        assert session.scalar(text("SHOW transaction_read_only")) == "on"
        assert (
            session.scalar(select(Rental.state).where(Rental.id == identifier))
            == "confirmed"
        )
        handover(custody)
        assert (
            session.scalar(select(Rental.state).where(Rental.id == identifier))
            == "confirmed"
        )
    assert dashboard.day(DayQuery(date="2026-10-10"))["queues"]["pickup"]["total"] == 0
    with migrated_engine.begin() as connection:
        config = migration_config(connection)
        migration.downgrade(config, "0011_handovers")
        assert (
            connection.scalar(select(Rental.state).where(Rental.id == identifier))
            == "out"
        )
        migration.upgrade(config, "head")
        assert (
            compare_metadata(MigrationContext.configure(connection), Base.metadata)
            == []
        )
