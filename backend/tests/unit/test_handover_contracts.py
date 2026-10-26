from uuid import uuid4

import pytest
from pydantic import ValidationError

from locatto_api.handover_contracts import (
    FinancialAgreementCommand,
    HandoverCommand,
    ResolutionCommand,
    ReturnCommand,
)


def base():
    return {
        "request_id": str(uuid4()),
        "reason": "Synthetic explicit agreement",
        "expected_rental_version": 1,
        "expected_quotation_version": 1,
        "expected_financial_version": 2,
        "expected_contract_version": 1,
    }


@pytest.mark.parametrize("quantity", [0, -1, True, "1", 1.2, 2147483648])
def test_strict_received_quantity(quantity):
    with pytest.raises(ValidationError):
        ReturnCommand.model_validate(
            {
                **base(),
                "business_date": "2026-10-11",
                "lines": [
                    {
                        "product_id": str(uuid4()),
                        "condition": "fit",
                        "quantity": quantity,
                    }
                ],
            }
        )


@pytest.mark.parametrize(
    "amount", ["1", "1.1", "1.001", 1, 1.5, "NaN", "Infinity", "0.00", "10000000000.00"]
)
def test_exact_positive_agreed_amount(amount):
    with pytest.raises(ValidationError):
        FinancialAgreementCommand.model_validate(
            {
                **base(),
                "kind": "repair",
                "quantity": 1,
                "amount": amount,
                "agreed": True,
            }
        )


def test_third_party_requires_private_name_and_authorization_no_document_field():
    line = {"product_id": str(uuid4()), "quantity": 1, "condition": "Conferido"}
    for party in (
        {"name": ""},
        {"name": "Synthetic", "authorization": ""},
        {"name": "Synthetic", "authorization": "Authorized", "cpf": "forbidden"},
    ):
        with pytest.raises(ValidationError):
            HandoverCommand.model_validate(
                {**base(), "lines": [line], "third_party": party}
            )
    with pytest.raises(ValidationError):
        HandoverCommand.model_validate({**base(), "lines": [line, line]})


def test_v2_maintenance_requires_explicit_agreement_and_strict_known_disposition():
    value = ResolutionCommand.model_validate(
        {**base(), "disposition": "maintenance", "quantity": 1, "agreed": True}
    )
    assert value.disposition == "maintenance"
    for changes in (
        {"agreed": False},
        {"agreed": None},
        {"agreed": 1},
        {"agreed": "true"},
        {"disposition": "deferred"},
        {"actor_id": str(uuid4())},
    ):
        with pytest.raises(ValidationError):
            ResolutionCommand.model_validate({**value.model_dump(), **changes})
