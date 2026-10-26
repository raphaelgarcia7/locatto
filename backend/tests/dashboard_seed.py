"""Synthetic persisted dashboard scenarios, only in the loopback browser wrapper.

Each browser receives a private UUID schema. Normal predecessor services create
custody/payment/contract facts. The volume case clones immutable synthetic
commercial/rental rows directly; it never makes a stock promise or uses real PII.
"""

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import Engine

from locatto_api.handover_contracts import (
    FinancialAgreementCommand,
    ForecastCommand,
    OperationalCommand,
)
from locatto_api.quotation_models import Quotation, QuotationVersion
from locatto_api.rental_models import Rental

from .integration.test_handovers import command, handover, receive, resolve
from .integration.test_handovers import custody as custody_fixture
from .integration.test_quotations import create


def seed_dashboard(engine: Engine, root: Path, scenario: str) -> dict[str, object]:
    custody = custody_fixture.__wrapped__(engine, root)
    service, actor, identifier, _, changes = custody
    # An unconfirmed persisted quotation must never enter calendar/day queues.
    create(changes[1][3])
    if scenario == "calendar":
        with service.factory.begin() as session:
            original = session.get(Rental, identifier)
            header = session.get(Quotation, original.quotation_id)
            offer = session.get(QuotationVersion, (header.id, header.current_version))
            for index in range(124):
                qid = uuid4()
                session.add(
                    Quotation(
                        id=qid,
                        customer_id=header.customer_id,
                        current_version=1,
                        created_at=header.created_at,
                    )
                )
                snapshot = dict(offer.snapshot)
                snapshot["pickup_time"] = "09:30" if index % 2 else None
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
                        actor_id=actor.user_id,
                        session_id=actor.session_id,
                    )
                )
                session.add(
                    Rental(
                        quotation_id=qid,
                        quotation_version=1,
                        confirmation_deposit=original.confirmation_deposit,
                        commercial_snapshot=snapshot,
                        financial_snapshot={},
                        actor_id=actor.user_id,
                        session_id=actor.session_id,
                        checked_at=original.checked_at,
                    )
                )
    else:
        state = handover(custody)[0][0]
        if scenario == "overdue":
            item = next(row for row in state["lines"] if row["quantity"] == 5)
            receive(
                custody,
                [{"product_id": item["product_id"], "quantity": 3, "condition": "fit"}],
            )
            service.execute(
                identifier,
                "forecast",
                command(custody, ForecastCommand, business_date="2026-10-16"),
                actor,
            )
        else:
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
            incidents = [
                row
                for row in service.get_operations(identifier)["incidents"]
                if row["kind"] == "damaged"
            ]
            for incident in incidents:
                resolve(custody, incident, "maintenance", incident["quantity"])
            service.execute(
                identifier, "close", command(custody, OperationalCommand), actor
            )
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
                UUID(incidents[0]["id"]),
            )
    with service.factory() as session:
        rental = session.get(Rental, identifier)
        header = session.get(Quotation, rental.quotation_id)
        return {
            "rental_id": str(identifier),
            "quotation_id": str(header.id),
            "customer_id": str(header.customer_id),
            "scenario": scenario,
            "seeded_at": datetime.now(UTC).isoformat(),
        }
