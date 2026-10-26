"""Exercise real HTTP validation/middleware without database or private records."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from locatto_api.auth import Identity
from locatto_api.auth_routes import auth_service
from locatto_api.contract_contracts import CompanyView
from locatto_api.contract_routes import contract_service
from locatto_api.main import app
from locatto_api.payment_errors import PaymentError


class BoundaryService:
    def __init__(self):
        self.versions = []

    def update_company(self, command, identity, upload):
        self.versions.append(command.expected_version)
        return CompanyView(
            version=command.expected_version, logo=None, pending=[]
        ).model_dump(mode="json")

    def event(self, identifier, number, command, identity, upload):
        self.versions.append(command.expected_contract_version)
        raise PaymentError(409, "version_conflict", "Versão mudou.")


@pytest.fixture
def boundary() -> Iterator[tuple[TestClient, BoundaryService]]:
    expiry = datetime.now(UTC) + timedelta(hours=1)
    identity = Identity(uuid4(), uuid4(), expiry, expiry)
    authentication = SimpleNamespace(
        settings=SimpleNamespace(origin="http://testserver"),
        identity=lambda token: identity,
    )
    service = BoundaryService()
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[auth_service] = lambda: authentication
    app.dependency_overrides[contract_service] = lambda: service
    try:
        with TestClient(app, headers={"Origin": "http://testserver"}) as client:
            yield client, service
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def parts(version, *, signature=False):
    fields = {
        "request_id": str(uuid4()),
        "expected_contract_version" if signature else "expected_version": str(version),
    }
    if signature:
        fields.update(reviewed="false", signed_date="", declaration="")
    return [(key, (None, value)) for key, value in fields.items()] + [
        ("file", ("synthetic.png", b"synthetic bytes", "image/png"))
    ]


@pytest.mark.parametrize("version", [-1, 2_147_483_648, 10**40, "invalid", "1.5"])
def test_logo_rejects_invalid_versions_at_http_boundary(boundary, version):
    client, service = boundary
    response = client.post("/parameters/logo", files=parts(version))
    assert response.status_code == 422
    assert service.versions == []
    assert str(version) not in response.text


@pytest.mark.parametrize("version", [0, 2_147_483_647])
def test_logo_accepts_both_command_version_boundaries(boundary, version):
    client, service = boundary
    response = client.post("/parameters/logo", files=parts(version))
    assert response.status_code == 200
    assert response.json()["version"] == version
    assert service.versions == [version]


@pytest.mark.parametrize("version", [0, 2_147_483_648, 10**40, "invalid", "1.5"])
def test_signature_rejects_invalid_versions_before_service(boundary, version):
    client, service = boundary
    response = client.post(
        f"/contracts/{uuid4()}/versions/1/signatures",
        files=parts(version, signature=True),
    )
    assert response.status_code == 422
    assert service.versions == []


@pytest.mark.parametrize("version", [1, 2_147_483_647])
def test_signature_accepts_both_command_version_boundaries(boundary, version):
    client, service = boundary
    response = client.post(
        f"/contracts/{uuid4()}/versions/1/signatures",
        files=parts(version, signature=True),
    )
    assert response.status_code == 409
    assert service.versions == [version]


@pytest.mark.parametrize("signature", [False, True])
@pytest.mark.parametrize("malformation", ["duplicate", "extra", "query", "missing"])
def test_multipart_shape_is_strict(boundary, signature, malformation):
    client, service = boundary
    url = (
        f"/contracts/{uuid4()}/versions/1/signatures"
        if signature
        else "/parameters/logo"
    )
    upload = parts(1, signature=signature)
    if malformation == "duplicate":
        upload.append(upload[0])
    elif malformation == "extra":
        upload.append(("unexpected", (None, "ignored")))
    elif malformation == "query":
        url += "?unexpected=ignored"
    else:
        upload = upload[:-1]
    response = client.post(url, files=upload)
    assert response.status_code == 422
    assert service.versions == []
