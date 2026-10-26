"""The loopback test wrapper injects fixture time, never a production/global clock."""

import asyncio
from contextlib import nullcontext
from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest

from locatto_api.auth_routes import auth_service
from locatto_api.contract_routes import contract_service
from locatto_api.handover_routes import handover_service
from locatto_api.payment_routes import payment_service
from locatto_api.quotation_contracts import validity_state
from locatto_api.quotation_routes import quotation_service
from locatto_api.quotations import QuotationService
from locatto_api.rental_changes import RentalChangeService
from locatto_api.rental_routes import rental_service
from tests import browser_server


def test_browser_clock_is_only_injected_into_quotation_and_rental_fixtures(monkeypatch):
    factory = object()
    engine = SimpleNamespace(begin=lambda: nullcontext(object()))

    def namespace():
        yield engine

    monkeypatch.setattr(
        browser_server, "isolated_engine", SimpleNamespace(__wrapped__=namespace)
    )
    monkeypatch.setattr(browser_server, "migration_config", lambda connection: None)
    monkeypatch.setattr(browser_server.command, "upgrade", lambda config, target: None)
    monkeypatch.setattr(browser_server, "build_session_factory", lambda engine: factory)
    previous = dict(browser_server.production_app.dependency_overrides)

    async def verify():
        before = datetime.now(UTC)
        async with browser_server.lifespan(browser_server.app):
            overrides = browser_server.production_app.dependency_overrides
            assert overrides[quotation_service]().clock() == datetime(
                2026, 10, 10, 12, tzinfo=UTC
            )
            assert (
                overrides[rental_service]().clock
                is browser_server.business_fixture_clock
            )
            assert (
                overrides[rental_service]().payments.clock
                is browser_server.business_fixture_clock
            )
            for service in [
                auth_service,
                contract_service,
                payment_service,
                handover_service,
            ]:
                current = overrides[service]().clock()
                assert before <= current <= datetime.now(UTC)
                assert current.tzinfo is UTC
            # Fresh service defaults outside the wrapper remain real UTC.
            for service in [QuotationService(factory), RentalChangeService(factory)]:
                assert before <= service.clock() <= datetime.now(UTC)
        assert not browser_server.production_app.dependency_overrides

    try:
        asyncio.run(verify())
    finally:
        browser_server.production_app.dependency_overrides.update(previous)


@pytest.mark.parametrize("day", [9, 10, 11])
def test_explicit_clock_does_not_reintroduce_removed_commercial_expiration(day):
    def clock():
        return datetime(2026, 10, day, 12, tzinfo=UTC)

    service = QuotationService(object(), clock=clock)
    state = validity_state(date(2026, 10, 10), service.clock())
    assert state == {"expired": False, "requires_revision": False, "state": "current"}
