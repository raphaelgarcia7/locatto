from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from locatto_api.auth import AuthService, AuthSettings
from locatto_api.auth_routes import auth_service
from locatto_api.dashboard import DashboardService
from locatto_api.dashboard_routes import dashboard_service
from locatto_api.main import app
from locatto_api.models import AuthSession, User

from .test_dashboard import dashboard_fixture as fixture

pytestmark = pytest.mark.integration


@pytest.fixture
def private_dashboard(migrated_engine, tmp_path):
    dashboard, custody = fixture.__wrapped__(migrated_engine, tmp_path)
    auth = AuthService(
        dashboard.factory,
        AuthSettings("http://localhost:5173", False, "synthetic-dashboard-api-key" * 3),
    )
    email = "synthetic-dashboard-api@example.invalid"
    auth.create_user(email)
    auth.set_password(
        auth.issue_link(email, "access"), "synthetic dashboard passphrase", "loopback"
    )
    app.dependency_overrides[auth_service] = lambda: auth
    app.dependency_overrides[dashboard_service] = lambda: dashboard
    try:
        with TestClient(app) as http:
            yield http, dashboard, auth, email, custody
    finally:
        app.dependency_overrides.clear()


def test_dash04_session_private_no_store_typed_queries_failure_not_empty(
    private_dashboard, caplog
):
    http, dashboard, auth, email, custody = private_dashboard
    paths = [
        "/operations/day?date=2026-10-10",
        "/operations/calendar?month=2026-10",
        "/operations/upcoming?from=2026-10-10&to=2026-10-13",
    ]
    for path in paths:
        assert http.get(path).status_code == 401
    assert (
        http.post(
            "/auth/password/login",
            headers={"Origin": "https://other.invalid"},
            json={"email": email, "password": "synthetic dashboard passphrase"},
        ).status_code
        == 403
    )
    assert (
        http.post(
            "/auth/password/login",
            headers={"Origin": "http://localhost:5173"},
            json={"email": email, "password": "synthetic dashboard passphrase"},
        ).status_code
        == 200
    )
    with auth.factory() as session:
        existing = session.scalar(
            select(AuthSession).join(User).where(User.email == email)
        )
        activity, expires = existing.last_activity, existing.expires_at
    auth.clock = lambda: activity + timedelta(seconds=61)
    for path in paths:
        response = http.get(path)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        for forbidden in (
            "cpf",
            "address",
            "phone",
            "rg",
            "storage_key",
            "receipts",
            "contract_id",
            "actor_id",
            "third_party",
            "observation",
        ):
            assert f'"{forbidden}"' not in response.text
    with auth.factory() as session:
        existing = session.scalar(
            select(AuthSession).join(User).where(User.email == email)
        )
        assert (existing.last_activity, existing.expires_at) == (activity, expires)
    for query in (
        "page_size=101",
        "page=1.0",
        "financial_pending=1",
        "date=2026-2-01",
        "customer_id=some-private-name",
        "actor_id=untrusted",
        "queue=nope",
    ):
        response = http.get(f"/operations/day?{query}")
        assert response.status_code == 422 and response.json() == {
            "detail": "Entrada inválida."
        }
    for query in (
        "from=2026-10-12&to=2026-10-11",
        "from=2026-01-01&to=2026-04-01",
        "from=9999-12-31",
        "to=2020-01-01",
    ):
        assert http.get(f"/operations/upcoming?{query}").status_code == 422
    with patch.object(
        DashboardService, "day", side_effect=OperationalError("", {}, Exception())
    ):
        response = http.get(paths[0])
        assert response.status_code == 503
        assert (
            "queues" not in response.json()
            and response.headers["cache-control"] == "no-store"
        )
    assert "some-private-name" not in caplog.text
    assert "Synthetic quotation customer" not in caplog.text
    auth.deactivate(email)
    assert http.get(paths[0]).status_code == 401


def test_dash02_query_default_today_uses_server_timezone(private_dashboard):
    http, dashboard, _, email, _ = private_dashboard
    assert (
        http.post(
            "/auth/password/login",
            headers={"Origin": "http://localhost:5173"},
            json={"email": email, "password": "synthetic dashboard passphrase"},
        ).status_code
        == 200
    )
    dashboard.clock = lambda: datetime(2027, 1, 1, 2, 59, tzinfo=UTC)
    assert http.get("/operations/day").json()["date"] == "2026-12-31"
    assert http.get("/operations/upcoming").json()["to_date"] == "2027-01-29"
