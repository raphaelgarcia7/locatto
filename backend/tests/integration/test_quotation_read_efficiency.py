"""Current rental facts are reused only within a version-history request."""

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event

from rentalops_api.capacity import outstanding_demand
from rentalops_api.catalog_storage import PhotoStorage
from rentalops_api.contract_contracts import SignatureCommand
from rentalops_api.contracts import ContractService
from rentalops_api.handovers import HandoverService
from rentalops_api.payment_contracts import CorrectionCommand
from rentalops_api.payments import PaymentService
from rentalops_api.rental_effects import rental_summary

from ..unit.test_contract_contracts import image_bytes
from .test_contracts import issue_command, ready
from .test_handovers import command, handover, receive
from .test_payments import versions as financial_versions
from .test_quotations import command_for, create, revision
from .test_quotations import quotations as quotation_fixture
from .test_rental_changes import cancel, change_command, confirmed
from .test_rental_changes import changes as changes_fixture

pytestmark = pytest.mark.integration


def revise(quotes, current):
    service, actor, _ = quotes
    payload = revision(quotes, current)
    command = command_for(service, payload, reason="Synthetic version history revision")
    return service.write(command, actor, UUID(current["id"]))[0]


def history_fixture(engine, tmp_path, state):
    if state == "none":
        quotes = quotation_fixture.__wrapped__(engine)
        current = create(quotes)
        for _ in range(3):
            current = revise(quotes, current)
        return quotes, UUID(current["id"]), None, None
    changes = changes_fixture.__wrapped__(engine, tmp_path)
    service, payments = changes
    current = confirmed(changes)
    identifier = UUID(current["id"])
    for amount in ("500", "550", "600"):
        current = service.command(
            identifier,
            "change",
            change_command(changes, current, total=Decimal(amount)),
            payments[1],
        )[0]
    if state == "confirmed":
        return payments[3], payments[2], changes, None
    custody_service = HandoverService(
        service.factory, lambda: datetime(2026, 10, 8, 12, tzinfo=UTC)
    )
    storage = tmp_path / "version-history-contracts"
    storage.mkdir(mode=0o700)
    contracts = ContractService(
        service.factory, PhotoStorage(storage), clock=custody_service.clock
    )
    contract_fixture = contracts, payments[1], payments[2], payments[3]
    ready(contract_fixture)
    issued = contracts.issue(payments[2], issue_command(contract_fixture), payments[1])
    contracts.event(
        UUID(issued["contract_id"]),
        1,
        SignatureCommand(
            request_id=uuid4(),
            expected_contract_version=1,
            reviewed=True,
            signed_date="2026-10-08",
            declaration="Synthetic signed current version",
        ),
        payments[1],
        (image_bytes(), "image/png"),
    )
    custody = custody_service, payments[1], identifier, contracts, changes
    sent = handover(custody)[0][0]
    if state == "completed":
        receive(
            custody,
            [
                {
                    "product_id": row["product_id"],
                    "quantity": row["quantity"],
                    "condition": "fit",
                }
                for row in sent["lines"]
            ],
        )
        custody_service.execute(identifier, "close", command(custody), payments[1])
    return payments[3], payments[2], changes, custody


@pytest.mark.parametrize("state", ["none", "confirmed", "out", "completed"])
def test_history_reuses_only_current_reads_and_preserves_every_version(
    migrated_engine, tmp_path, state
):
    quotes, identifier, changes, custody = history_fixture(
        migrated_engine, tmp_path, state
    )
    service, actor, _ = quotes
    expected = [service.get(identifier, number) for number in range(4, 0, -1)]
    statements = []

    def count(*_):
        statements.append(1)

    event.listen(migrated_engine, "before_cursor_execute", count)
    try:
        with (
            patch(
                "rentalops_api.quotations.rental_summary", wraps=rental_summary
            ) as summary,
            patch(
                "rentalops_api.quotations.outstanding_demand", wraps=outstanding_demand
            ) as physical,
            patch.object(
                PaymentService,
                "confirmation_summary",
                autospec=True,
                side_effect=PaymentService.confirmation_summary,
            ) as financial,
        ):
            actual = service.versions(identifier)
    finally:
        event.remove(migrated_engine, "before_cursor_execute", count)
    print({"state": state, "versions": len(actual), "queries": len(statements)})
    assert actual == expected
    assert summary.call_count == 1
    assert physical.call_count == (0 if state == "none" else 1)
    assert financial.call_count == (1 if state in {"out", "completed"} else 0)
    if state in {"none", "confirmed"}:
        # Four per-version capacity checks remain; duplicated current facts do not.
        assert len(statements) <= 30
    if state != "none":
        assert actual[0]["rental"] is not actual[1]["rental"]

    other = create(quotes)
    assert all(row["rental"] is None for row in service.versions(UUID(other["id"])))
    if state == "none":
        revise(quotes, actual[0])
        assert service.versions(identifier)[0]["version"] == 5
    elif state == "confirmed":
        cancel(changes, changes[0].get(UUID(actual[0]["rental"]["id"])))
        assert service.versions(identifier)[0]["rental"]["state"] == "cancelled"
    elif state == "out":
        row = custody[0].get_operations(custody[2])["lines"][0]
        receive(
            custody,
            [{"product_id": row["product_id"], "quantity": 1, "condition": "fit"}],
        )
        assert (
            service.versions(identifier)[0]["rental"]["version"]
            > actual[0]["rental"]["version"]
        )
    else:
        payments = changes[1]
        receipt = UUID(payments[0].get(identifier)["receipts"][0]["id"])
        payments[0].write(
            identifier,
            "correction",
            CorrectionCommand.model_validate(
                financial_versions(
                    payments[0],
                    identifier,
                    amount="100.00",
                    method="cash",
                    business_date="2026-10-08",
                    reason="Synthetic changed financial fact",
                )
            ),
            actor,
            receipt,
        )
        fresh = service.versions(identifier)
        assert (
            fresh[0]["rental"]["operational_debt"]
            != actual[0]["rental"]["operational_debt"]
        )
    fresh = service.versions(identifier)
    assert fresh == [service.get(identifier, row["version"]) for row in fresh]
