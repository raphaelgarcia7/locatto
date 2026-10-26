import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from locatto_api.auth import AuthService, AuthSettings
from locatto_api.auth_routes import auth_service
from locatto_api.catalog_storage import normalize_image
from locatto_api.contract_routes import contract_service
from locatto_api.main import app

from ..unit.test_contract_contracts import image_bytes
from ..unit.test_payment_storage import pdf
from .test_contracts import contracts as contract_fixture
from .test_contracts import issue_command, ready

pytestmark = pytest.mark.integration
ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


@pytest.fixture
def client(migrated_engine, tmp_path):
    fixture = contract_fixture.__wrapped__(migrated_engine, tmp_path)
    service = fixture[0]
    auth = AuthService(
        service.factory, AuthSettings(ORIGIN, False, "synthetic-contract-api-key" * 3)
    )
    email = "synthetic-contracts-api@example.invalid"
    auth.create_user(email)
    auth.set_password(
        auth.issue_link(email, "access"), "synthetic contract passphrase", "loopback"
    )
    app.dependency_overrides[auth_service] = lambda: auth
    app.dependency_overrides[contract_service] = lambda: service
    try:
        with TestClient(app) as http:
            yield http, fixture, email
    finally:
        app.dependency_overrides.clear()


def login(client):
    http, _, email = client
    response = http.post(
        "/auth/password/login",
        headers=HEADERS,
        json={"email": email, "password": "synthetic contract passphrase"},
    )
    assert response.status_code == 200


def test_ctr01_logo_private_upload_replay_validation_and_removal(client):
    http, _, _ = client
    login(client)
    body = {"request_id": str(uuid4()), "expected_version": "0"}
    for content, mime in [(b"<svg/>", "image/svg+xml"), (b"invalid", "image/png")]:
        assert (
            http.post(
                "/parameters/logo",
                headers=HEADERS,
                data=body,
                files={"file": ("ignored.png", content, mime)},
            ).status_code
            == 422
        )
    content = image_bytes(True)
    response = http.post(
        "/parameters/logo",
        headers=HEADERS,
        data=body,
        files={"file": ("ignored.png", content, "image/png")},
    )
    assert response.status_code == 200 and response.json()["version"] == 1
    assert "storage_key" not in response.text and "ignored.png" not in response.text
    assert (
        http.post(
            "/parameters/logo",
            headers=HEADERS,
            data=body,
            files={"file": ("ignored.png", content, "image/png")},
        ).json()
        == response.json()
    )
    download = http.get("/parameters/logo")
    assert download.content == normalize_image(content, "image/png")[0]
    assert download.headers["Cache-Control"] == "no-store"
    assert download.headers["X-Content-Type-Options"] == "nosniff"
    assert (
        http.post(
            "/parameters/logo/removal",
            headers=HEADERS,
            json={"request_id": str(uuid4()), "expected_version": 1, "remove": True},
        ).json()["version"]
        == 2
    )
    assert http.get("/parameters/logo").status_code == 404


def test_ctr04_all_private_routes_origin_strict_errors_no_raw_input(client, caplog):
    http, fixture, _ = client
    service, _, quotation_id, _ = fixture
    identifier, attachment = uuid4(), uuid4()
    base = f"/contracts/{identifier}/versions/1"
    get_paths = [
        "/parameters",
        "/parameters/logo",
        f"/quotations/{quotation_id}/contracts",
        f"/quotations/{quotation_id}/contracts/current-signature-state",
        f"/contracts/{identifier}/versions",
        f"/contracts/{identifier}/current-signature-state",
        base,
        base + "/download",
        base + f"/signatures/{attachment}/download",
    ]
    post_paths = [
        "/parameters",
        "/parameters/logo",
        "/parameters/logo/removal",
        f"/quotations/{quotation_id}/contracts/preview",
        f"/quotations/{quotation_id}/contracts",
        base + "/deliveries",
        base + "/signatures",
        base + f"/signatures/{attachment}/validations",
    ]
    for path in get_paths:
        assert http.get(path).status_code == 401
    for path in post_paths:
        assert http.post(path, headers=HEADERS, json={}).status_code == 401
    login(client)
    for path in post_paths:
        assert http.post(path, json={}).status_code == 403
        assert (
            http.post(
                path, headers={"Origin": "https://other.invalid"}, json={}
            ).status_code
            == 403
        )
    bad = {
        "request_id": str(uuid4()),
        "expected_version": 0,
        "actor_id": "private-invalid-sentinel",
    }
    response = http.post("/parameters", headers=HEADERS, json=bad)
    assert (
        response.status_code == 422 and "private-invalid-sentinel" not in response.text
    )
    assert "private-invalid-sentinel" not in caplog.text
    assert http.get("/parameters").headers["Cache-Control"] == "no-store"
    assert http.get(base + "/download").status_code == 404
    ready(fixture)
    body = issue_command(fixture).model_dump(mode="json")
    response = http.post(
        f"/quotations/{quotation_id}/contracts", headers=HEADERS, json=body
    )
    assert response.status_code == 200
    issued = response.json()
    assert "storage_key" not in response.text and "content" not in response.text
    assert (
        http.post(
            f"/quotations/{quotation_id}/contracts", headers=HEADERS, json=body
        ).json()
        == issued
    )
    path = f"/contracts/{issued['contract_id']}/versions/1/download"
    document = http.get(path)
    assert document.status_code == 200 and document.content.startswith(b"%PDF")
    assert document.headers["Cache-Control"] == "no-store"
    assert document.headers["X-Content-Type-Options"] == "nosniff"
    assert (
        document.headers["Content-Disposition"]
        == 'attachment; filename="contrato-v1.pdf"'
    )
    assert (
        http.get(f"/contracts/{issued['contract_id']}/versions/2/download").status_code
        == 404
    )
    assert service.signature_state(quotation_id)["ready_for_pickup"] is False


def test_ctr04_05_signature_limits_active_encrypted_mismatch_and_explicit_validation(
    client,
):
    http, fixture, _ = client
    login(client)
    ready(fixture)
    service, actor, quotation_id, _ = fixture
    issued = service.issue(quotation_id, issue_command(fixture), actor)
    base = f"/contracts/{issued['contract_id']}/versions/1/signatures"

    def fields(**changes):
        return {
            "request_id": str(uuid4()),
            "expected_contract_version": "1",
            "reviewed": "false",
            "signed_date": "",
            "declaration": "",
            **changes,
        }

    for content, mime in [
        (b"not pdf", "application/pdf"),
        (pdf(javascript=True), "application/pdf"),
        (pdf(encrypted=True), "application/pdf"),
        (image_bytes(), "application/pdf"),
    ]:
        response = http.post(
            base,
            headers=HEADERS,
            data=fields(),
            files={"file": ("ignored.pdf", content, mime)},
        )
        assert response.status_code == 422
    response = http.post(
        base,
        headers=HEADERS,
        data=fields(),
        files={"file": ("ignored.pdf", b"x" * 10_000_001, "application/pdf")},
    )
    assert response.status_code == 413
    body = fields()
    response = http.post(
        base,
        headers=HEADERS,
        data=body,
        files={"file": ("ignored.pdf", pdf(), "application/pdf")},
    )
    assert response.status_code == 200
    assert response.json()["signature_state"] == "awaiting_review"
    assert (
        http.post(
            base,
            headers=HEADERS,
            data=body,
            files={"file": ("ignored.pdf", pdf(), "application/pdf")},
        ).json()
        == response.json()
    )
    attachment = response.json()["events"][0]["id"]
    assert http.get(base + f"/{attachment}/download").content == pdf()
    assert (
        http.get(
            f"/contracts/{uuid4()}/versions/1/signatures/{attachment}/download"
        ).status_code
        == 404
    )
    assert (
        http.post(
            base + f"/{attachment}/validations",
            headers=HEADERS,
            json={
                "request_id": str(uuid4()),
                "expected_contract_version": 1,
                "signed_date": "2026-10-10",
                "declaration": "Conferência manual sintética",
            },
        ).json()["signature_state"]
        == "signed"
    )
    assert (
        http.post(
            base,
            headers=HEADERS,
            data=fields(unexpected="no"),
            files={"file": ("ignored.png", image_bytes(), "image/png")},
        ).status_code
        == 422
    )
    assert "ignored.pdf" not in json.dumps(
        service.versions(UUID(issued["contract_id"]))
    )
