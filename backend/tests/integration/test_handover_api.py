from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from rentalops_api.auth import AuthService, AuthSettings
from rentalops_api.auth_routes import auth_service
from rentalops_api.handover_contracts import (
    FinancialAgreementCommand,
    HandoverCommand,
    OperationalCommand,
    ResolutionCommand,
    ReturnCommand,
)
from rentalops_api.handover_routes import handover_service
from rentalops_api.main import app
from rentalops_api.payment_routes import payment_service
from rentalops_api.rental_models import RentalRequest
from rentalops_api.rental_routes import rental_service

from .test_contract_api import HEADERS, ORIGIN, login
from .test_handovers import command
from .test_handovers import custody as custody_fixture

pytestmark = pytest.mark.integration


@pytest.fixture
def custody(migrated_engine, tmp_path):
    return custody_fixture.__wrapped__(migrated_engine, tmp_path)


def test_ret07_operations_read_coexists_with_uncommitted_actor_audit(custody):
    service, _, identifier, _, _ = custody
    auth = AuthService(
        service.factory, AuthSettings(ORIGIN, False, "synthetic-read-audit-key" * 3)
    )
    email = "synthetic-read-audit@example.invalid"
    user, _ = auth.create_user(email)
    auth.set_password(
        auth.issue_link(email, "access"), "synthetic contract passphrase", "loopback"
    )
    app.dependency_overrides[auth_service] = lambda: auth
    app.dependency_overrides[handover_service] = lambda: service
    request_id = uuid4()
    try:
        with TestClient(app) as http:
            login((http, custody, email))
            with service.factory() as transaction:
                # The actual custody idempotency FK holds KEY SHARE on its actor
                # until commit. A private read must not demand an exclusive user
                # lock and turn that ordinary audit overlap into dependency503.
                transaction.add(
                    RentalRequest(
                        actor_id=user,
                        operation="synthetic-custody-overlap",
                        request_id=request_id,
                        payload_hash="0" * 64,
                        status=201,
                        result={},
                    )
                )
                transaction.flush()
                with ThreadPoolExecutor(max_workers=1) as executor:
                    response = executor.submit(
                        http.get, f"/rentals/{identifier}/operations"
                    ).result(timeout=8)
                assert response.status_code == 200
                assert response.json()["financial"]["received"] == "200.00"
                transaction.rollback()
            assert http.get(f"/rentals/{identifier}/operations").status_code == 200
            auth.deactivate(email)
            assert http.get(f"/rentals/{identifier}/operations").status_code == 401
        with service.factory() as db:
            assert (
                db.get(RentalRequest, (user, "synthetic-custody-overlap", request_id))
                is None
            )
    finally:
        app.dependency_overrides.clear()


def test_ret07_private_routes_session_origin_csrf_strict_input_history(custody, caplog):
    service, _, identifier, _, _ = custody
    auth = AuthService(
        service.factory, AuthSettings(ORIGIN, False, "synthetic-handover-api-key" * 3)
    )
    email = "synthetic-handover-api@example.invalid"
    auth.create_user(email)
    auth.set_password(
        auth.issue_link(email, "access"), "synthetic contract passphrase", "loopback"
    )
    http = TestClient(app)
    client = http, custody, email
    app.dependency_overrides[auth_service] = lambda: auth
    app.dependency_overrides[handover_service] = lambda: service
    app.dependency_overrides[rental_service] = lambda: service
    app.dependency_overrides[payment_service] = lambda: service.payments
    root = f"/rentals/{identifier}"
    mutations = [
        "handover-preview",
        "handover",
        "returns",
        "return-forecast",
        "close",
        f"incidents/{uuid4()}/resolutions",
        f"incidents/{uuid4()}/financial-agreements",
    ]
    try:
        assert http.get(root + "/operations").status_code == 401
        for path in mutations:
            assert (
                http.post(root + "/" + path, headers=HEADERS, json={}).status_code
                == 401
            )
        login(client)
        for path in mutations:
            for headers in (
                {},
                {"Origin": "https://other.invalid"},
                {"Origin": "null"},
            ):
                assert (
                    http.post(root + "/" + path, headers=headers, json={}).status_code
                    == 403
                )
        state = http.get(root + "/operations")
        assert state.status_code == 200 and state.headers["cache-control"] == "no-store"
        assert http.get(f"/rentals/{uuid4()}/operations").status_code == 404
        value = state.json()
        payload = command(
            custody,
            HandoverCommand,
            lines=[
                {
                    "product_id": row["product_id"],
                    "quantity": row["quantity"],
                    "condition": "Conferência sintética",
                }
                for row in value["lines"]
            ],
            balance_exception="Exceção sintética registrada",
            third_party={
                "name": "Pessoa Sintética",
                "authorization": "Autorização sintética explícita",
            },
        ).model_dump(mode="json")
        assert (
            http.post(
                root + "/handover",
                headers=HEADERS,
                json={**payload, "actor_id": str(uuid4())},
            ).status_code
            == 422
        )
        result = http.post(root + "/handover", headers=HEADERS, json=payload)
        assert result.status_code == 201
        assert result.headers["cache-control"] == "no-store"
        assert result.json()["handover"]["third_party"] == payload["third_party"]
        assert (
            http.post(root + "/handover", headers=HEADERS, json=payload).status_code
            == 200
        )
        assert http.get(root + "/history").json()["total"] == 2
        assert "Pessoa Sintética" not in caplog.text
        assert "Autorização sintética explícita" not in caplog.text
        state = result.json()
        received = command(
            custody,
            ReturnCommand,
            business_date="2026-10-08",
            lines=[
                {
                    "product_id": row["product_id"],
                    "quantity": row["quantity"],
                    "condition": "damaged",
                }
                for row in state["lines"]
            ],
        ).model_dump(mode="json")
        response = http.post(root + "/returns", headers=HEADERS, json=received)
        assert response.status_code == 201
        assert (
            http.post(root + "/returns", headers=HEADERS, json=received).json()
            == response.json()
        )
        assert (
            http.post(
                root + "/close",
                headers=HEADERS,
                json=command(custody).model_dump(mode="json"),
            ).status_code
            == 409
        )
        for incident in response.json()["incidents"]:
            if incident["kind"] != "damaged":
                continue
            decision = command(
                custody,
                ResolutionCommand,
                disposition="maintenance",
                quantity=incident["quantity"],
                agreed=True,
            ).model_dump(mode="json")
            url = root + f"/incidents/{incident['id']}/resolutions"
            response = http.post(url, headers=HEADERS, json=decision)
            assert response.status_code == 201
            assert (
                http.post(url, headers=HEADERS, json=decision).json() == response.json()
            )
        closing = command(custody, OperationalCommand).model_dump(mode="json")
        response = http.post(root + "/close", headers=HEADERS, json=closing)
        assert response.status_code == 201 and response.json()["state"] == "completed"
        assert (
            http.post(root + "/close", headers=HEADERS, json=closing).json()
            == response.json()
        )
        assert response.json()["financial"]["operational_debt"] == "200.00"
        incident = next(
            row for row in response.json()["incidents"] if row["kind"] == "damaged"
        )
        agreement = command(
            custody,
            FinancialAgreementCommand,
            kind="repair",
            quantity=1,
            amount="20.00",
            agreed=True,
        ).model_dump(mode="json")
        url = root + f"/incidents/{incident['id']}/financial-agreements"
        response = http.post(url, headers=HEADERS, json=agreement)
        assert response.status_code == 201
        assert http.post(url, headers=HEADERS, json=agreement).json() == response.json()
        assert response.json()["financial"]["operational_debt"] == "220.00"
        assert response.json()["financial"]["received"] == "200.00"
        financial_history = http.get(
            f"/quotations/{response.json()['financial']['quotation_id']}/payments/history"
        )
        assert financial_history.status_code == 200
        event = next(
            row
            for row in financial_history.json()["items"]
            if row["operation"] == "incident_agreement"
        )
        assert event["after"] == response.json()["financial"]
        assert event["before"]["receipts"] == event["after"]["receipts"]
        released = command(
            custody,
            ResolutionCommand,
            disposition="repaired",
            quantity=incident["quantity"],
            agreed=True,
        ).model_dump(mode="json")
        url = root + f"/incidents/{incident['id']}/resolutions"
        response = http.post(url, headers=HEADERS, json=released)
        assert response.status_code == 201 and response.json()["state"] == "completed"
        assert http.post(url, headers=HEADERS, json=released).json() == response.json()
        history = http.get(root + "/history").json()
        assert (
            history["items"][-1]["after"]["financial"]["operational_debt"] == "220.00"
        )
    finally:
        http.close()
        app.dependency_overrides.clear()
