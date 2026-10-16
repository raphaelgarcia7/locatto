"""Operational extras are shared, replay-safe and isolated from rental finances."""

import io
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from pypdf import PdfReader

from rentalops_api.contract_pdf import render_separation_checklist
from rentalops_api.rental_checklists import ChecklistCommand, ChecklistService
from rentalops_api.rental_models import Rental
from rentalops_api.rentals import RentalError

from .test_rentals import confirmation, paid
from .test_rentals import rentals as rentals

pytestmark = pytest.mark.integration


def prepared(rentals):
    service, payments = rentals
    paid(payments)
    rental, _ = service.confirm(payments[2], confirmation(payments), payments[1])
    return (
        ChecklistService(service.factory),
        UUID(rental["id"]),
        payments[1],
        rental,
        service,
    )


def payload(view, **changes):
    return ChecklistCommand.model_validate(
        {
            "request_id": str(uuid4()),
            "expected_version": view["version"],
            "expected_rental_version": view["rental_version"],
            "checked_products": [view["products"][0]["id"]],
            "extras": [
                {
                    "id": str(uuid4()),
                    "label": "10 pregadores e elásticos",
                    "checked": True,
                }
            ],
            **changes,
        }
    )


def test_checklist_products_expand_kits_extras_persist_replay_and_no_commercial_effects(
    rentals,
):
    service, identifier, actor, rental, original = prepared(rentals)
    view = service.get(identifier)
    assert sorted(row["quantity"] for row in view["products"]) == [2, 5]
    assert view["extras"] == [] and view["version"] == 0
    command = payload(view)
    result, replay = service.save(identifier, command, actor)
    assert not replay and result["version"] == 1
    assert service.get(identifier) == result
    assert service.save(identifier, command, actor) == (result, True)
    assert (
        original.get(identifier) == rental
    )  # No allocation, signature or money version changed.
    commercial, current = service.snapshot(identifier)
    pdf = render_separation_checklist(commercial, current)
    content = "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
    assert "Extras de preparação (sem cobrança)" in content
    assert "10 pregadores e elásticos" in content
    assert "10 pregadores" not in str(commercial)
    with pytest.raises(RentalError) as conflict:
        service.save(identifier, command.model_copy(update={"extras": []}), actor)
    assert conflict.value.code == "idempotency_conflict"
    with pytest.raises(RentalError) as conflict:
        service.save(identifier, payload(view), actor)
    assert conflict.value.code == "version_conflict"


def test_checklist_concurrent_saves_do_not_overwrite_other_preparer(rentals):
    service, identifier, actor, _, _ = prepared(rentals)
    view = service.get(identifier)

    def save(command):
        try:
            return service.save(identifier, command, actor)[0]["version"]
        except RentalError as problem:
            return problem.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [payload(view), payload(view)]))
    assert sorted(map(str, results)) == ["1", "version_conflict"]
    assert len(service.get(identifier)["extras"]) == 1


def test_checklist_stale_composition_clears_checks_but_preserves_extra_labels(rentals):
    service, identifier, actor, _, original = prepared(rentals)
    saved, _ = service.save(identifier, payload(service.get(identifier)), actor)
    # Exercise a changed commercial snapshot without bypassing any real command guard.
    from rentalops_api.rental_checklists import checklist_view
    from rentalops_api.rental_models import RentalChecklist

    with original.factory() as session:
        rental = session.get(Rental, identifier)
        stored = session.get(RentalChecklist, identifier)
        rental.quotation_version += 1
        changed = checklist_view(rental, stored)
        assert changed["needs_recheck"]
        assert not any(
            row["checked"] for row in changed["products"] + changed["extras"]
        )
        assert changed["extras"][0]["label"] == saved["extras"][0]["label"]
        session.rollback()
    with pytest.raises(RentalError) as invalid:
        service.save(identifier, payload(saved, checked_products=[str(uuid4())]), actor)
    assert invalid.value.code == "invalid_product"
