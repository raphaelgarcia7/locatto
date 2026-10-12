"""Loopback-only disposable PostgreSQL harness; never import in production.

Requires TEST_DATABASE_URL and uses the same fail-closed UUID schema fixture as
integration. Test control endpoints exist only in this wrapper, never main.app.
"""

import logging
import os
from contextlib import ExitStack, asynccontextmanager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from uuid import uuid4

import uvicorn
from alembic import command
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import event

from rentalops_api.auth import AuthError, AuthService, AuthSettings
from rentalops_api.auth_routes import auth_service
from rentalops_api.catalog import CatalogService
from rentalops_api.catalog_routes import catalog_service
from rentalops_api.catalog_storage import PhotoStorage
from rentalops_api.contract_routes import contract_service
from rentalops_api.contracts import ContractService
from rentalops_api.customer_routes import customer_service
from rentalops_api.customers import CustomerService
from rentalops_api.database import build_session_factory
from rentalops_api.handover_routes import handover_service
from rentalops_api.handovers import HandoverService
from rentalops_api.main import app as production_app
from rentalops_api.payment_routes import payment_service
from rentalops_api.payment_storage import ProofStorage
from rentalops_api.payments import PaymentService
from rentalops_api.quotation_routes import quotation_service
from rentalops_api.quotations import QuotationService
from rentalops_api.rental_changes import RentalChangeService
from rentalops_api.rental_routes import rental_service

from .conftest import isolated_engine, migration_config


def business_fixture_clock() -> datetime:
    # Only quotation/rental fixtures have fixed calendar scenarios. Their
    # synthetic audit timestamps share this existing injected service clock.
    # Auth, contracts, standalone payments and production defaults stay real.
    return datetime(2026, 10, 10, 12, tzinfo=UTC)


@dataclass
class BrowserFixture:
    auth: AuthService
    catalog: CatalogService
    customers: CustomerService
    quotations: QuotationService
    payments: PaymentService
    rentals: RentalChangeService
    contracts: ContractService
    custody: HandoverService


# Only schema initialization uses this lock: Alembic's migration context is
# process-global. Requests, business transactions and parallel tests do not.
migration_lock = Lock()
if os.environ.get("RENTALOPS_TEST_DIAGNOSTICS") == "safe":
    logging.getLogger("rentalops.operations").setLevel(logging.INFO)
    handler = logging.StreamHandler()
    logging.getLogger("rentalops.operations").addHandler(handler)
fixture_context: ContextVar[BrowserFixture | None] = ContextVar(
    "browser_fixture", default=None
)
FIXTURE_COOKIE = "rentalops_test_fixture"


@contextmanager
def browser_fixture():
    namespace = isolated_engine.__wrapped__()
    engine = next(namespace)
    if os.environ.get("RENTALOPS_TEST_DIAGNOSTICS") == "safe":

        @event.listens_for(engine, "handle_error")
        def safe_database_error(context):
            # Never emit statement, exception text, parameters or user data.
            original = context.original_exception
            print(
                {
                    "test_database_error": type(original).__name__,
                    "sqlstate": getattr(original, "sqlstate", None),
                },
                flush=True,
            )

    storage = TemporaryDirectory(prefix="rentalops-catalog-browser-")
    try:
        with migration_lock, engine.begin() as connection:
            command.upgrade(migration_config(connection), "head")
        service = AuthService(
            build_session_factory(engine),
            AuthSettings(
                "http://127.0.0.1:4173", False, "synthetic-browser-test-key" * 3
            ),
        )
        catalog = CatalogService(
            build_session_factory(engine), PhotoStorage(Path(storage.name))
        )
        customers = CustomerService(build_session_factory(engine))
        quotations = QuotationService(
            build_session_factory(engine), clock=business_fixture_clock
        )
        payments = PaymentService(
            build_session_factory(engine), ProofStorage(Path(storage.name))
        )
        rentals = RentalChangeService(
            build_session_factory(engine), clock=business_fixture_clock
        )
        contracts = ContractService(
            build_session_factory(engine), PhotoStorage(Path(storage.name))
        )
        custody = HandoverService(build_session_factory(engine))
        yield BrowserFixture(
            service,
            catalog,
            customers,
            quotations,
            payments,
            rentals,
            contracts,
            custody,
        )
    finally:
        namespace.close()
        storage.cleanup()


def current_fixture() -> BrowserFixture:
    return fixture_context.get() or app.state.fixture


def fixture_dependency(attribute):
    def resolve():
        return getattr(current_fixture(), attribute)

    return resolve


@asynccontextmanager
async def lifespan(app):
    with ExitStack() as resources:
        app.state.resources = resources
        app.state.fixture = resources.enter_context(browser_fixture())
        app.state.fixtures = {}
        app.state.targets = set()
        for dependency, attribute in (
            (auth_service, "auth"),
            (catalog_service, "catalog"),
            (customer_service, "customers"),
            (quotation_service, "quotations"),
            (payment_service, "payments"),
            (rental_service, "rentals"),
            (contract_service, "contracts"),
            (handover_service, "custody"),
        ):
            production_app.dependency_overrides[dependency] = fixture_dependency(
                attribute
            )
        try:
            yield
        finally:
            production_app.dependency_overrides.clear()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def scoped_fixture(request, call_next):
    key = request.cookies.get(FIXTURE_COOKIE)
    if key is not None and key not in app.state.fixtures:
        return JSONResponse({"detail": "Unknown synthetic fixture."}, status_code=400)
    fixture = app.state.fixtures[key] if key else app.state.fixture
    token = fixture_context.set(fixture)
    try:
        return await call_next(request)
    finally:
        fixture_context.reset(token)


@app.get("/__test/health")
def health():
    return {"status": "ready"}


@app.post("/__test/cleanup")
def cleanup(request: Request):
    production_app.dependency_overrides.clear()
    request.app.state.resources.close()
    return {"status": "cleaned"}


@app.post("/__test/setup")
def setup(request: Request, response: Response, isolated: bool = False):
    fixture = current_fixture()
    if isolated:
        # Company parameters are intentionally global in the product. Give each
        # contract/custody test its own real schema, not competing global seeds.
        fixture = request.app.state.resources.enter_context(browser_fixture())
        key = uuid4().hex
        request.app.state.fixtures[key] = fixture
        response.set_cookie(FIXTURE_COOKIE, key, httponly=True, samesite="lax")
    email = f"browser-{uuid4().hex}@example.invalid"
    service = fixture.auth
    service.create_user(email)
    request.app.state.targets.add(email)
    token = service.issue_link(email, "access")
    return {"email": email, "token": token}


class Control(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str
    operation: str


@app.post("/__test/control")
def control(payload: Control, request: Request):
    if payload.email not in request.app.state.targets:
        raise AuthError(400, "Synthetic test target required.")
    service = current_fixture().auth
    if payload.operation == "reset":
        return {"token": service.issue_link(payload.email, "reset")}
    if payload.operation == "deactivate":
        service.deactivate(payload.email)
        return {"status": "deactivated"}
    raise AuthError(400, "Synthetic test operation required.")


app.mount("/", production_app)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        access_log=False,
        proxy_headers=False,
        log_level="warning",
    )
