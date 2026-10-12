"""Concurrent synthetic contexts use real, separately cleaned PostgreSQL schemas."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests import browser_server

from .test_contracts import synthetic_address

pytestmark = pytest.mark.integration


def test_parallel_browser_parameters_isolated_guards_and_schema_cleanup(
    migrated_engine,
):
    previous = dict(browser_server.production_app.dependency_overrides)
    namespaces = []
    clients = [TestClient(browser_server.app), TestClient(browser_server.app)]
    barrier = Barrier(2)

    def run(client, name):
        setup = client.post("/__test/setup?isolated=true")
        assert setup.status_code == 200
        account = setup.json()
        headers = {"Origin": "http://127.0.0.1:4173"}
        password = "synthetic isolated browser phrase"
        assert (
            client.post(
                "/auth/password/set",
                headers=headers,
                json={"token": account["token"], "password": password},
            ).status_code
            == 204
        )
        assert (
            client.post(
                "/auth/password/login",
                headers=headers,
                json={"email": account["email"], "password": password},
            ).status_code
            == 200
        )
        company = client.get("/parameters")
        assert company.status_code == 200 and company.json()["version"] == 0
        barrier.wait()
        body = {
            "request_id": str(uuid4()),
            "expected_version": 0,
            "name": name,
            "identification": "IDENTIFICAÇÃO SINTÉTICA",
            "contact": "Contato sintético",
            "address": synthetic_address(),
        }
        saved = client.post("/parameters", headers=headers, json=body)
        assert saved.status_code == 200 and saved.json()["version"] == 1
        assert client.get("/parameters").json()["name"] == name
        # Isolation never permits an actual stale write or untrusted origin.
        assert (
            client.post(
                "/parameters",
                headers=headers,
                json={**body, "request_id": str(uuid4())},
            ).status_code
            == 409
        )
        assert client.post("/parameters", json=body).status_code == 403

    try:
        with TestClient(browser_server.app) as harness:
            with ThreadPoolExecutor(2) as pool:
                results = [
                    pool.submit(run, client, f"Locadora Sintética {index}")
                    for index, client in enumerate(clients)
                ]
                for result in results:
                    result.result()
            assert browser_server.app.state.fixture.contracts.company()["version"] == 0
            for fixture in [
                browser_server.app.state.fixture,
                *browser_server.app.state.fixtures.values(),
            ]:
                with fixture.auth.factory() as session:
                    namespaces.append(session.scalar(text("SELECT current_schema()")))
            assert len(namespaces) == len(set(namespaces)) == 3
            # A session from another schema cannot authenticate in this context.
            first_session = clients[0].cookies.get("rentalops_session")
            clients[1].cookies.set("rentalops_session", first_session)
            assert clients[1].get("/parameters").status_code == 401
            harness.cookies.set(browser_server.FIXTURE_COOKIE, "unknown")
            assert harness.get("/parameters").status_code == 400
        with migrated_engine.connect() as connection:
            for namespace in namespaces:
                assert (
                    connection.scalar(
                        text("SELECT count(*) FROM pg_namespace WHERE nspname = :name"),
                        {"name": namespace},
                    )
                    == 0
                )
    finally:
        for client in clients:
            client.close()
        browser_server.production_app.dependency_overrides.clear()
        browser_server.production_app.dependency_overrides.update(previous)
