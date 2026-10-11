"""Private custody commands; authentication and Origin reuse existing boundaries."""

from collections.abc import Iterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from rentalops_api.auth_routes import CurrentIdentity
from rentalops_api.config import DatabaseSettings
from rentalops_api.customer_routes import private_response
from rentalops_api.database import build_engine, build_session_factory
from rentalops_api.handover_contracts import (
    FinancialAgreementCommand,
    ForecastCommand,
    HandoverCommand,
    HandoverPreviewView,
    HandoverVersions,
    OperationalCommand,
    OperationsView,
    ResolutionCommand,
    ReturnCommand,
)
from rentalops_api.handovers import HandoverService
from rentalops_api.rental_routes import mutation

router = APIRouter(tags=["Custody"], dependencies=[Depends(private_response)])


def handover_service() -> Iterator[HandoverService]:
    engine = build_engine(DatabaseSettings.from_environment())
    try:
        yield HandoverService(build_session_factory(engine))
    finally:
        engine.dispose()


Service = Annotated[HandoverService, Depends(handover_service)]


def result_status(
    result: tuple[dict[str, object], bool], response: Response
) -> dict[str, object]:
    value, replay = result
    response.status_code = 200 if replay else 201
    return value


@router.get("/rentals/{identifier}/operations", response_model=OperationsView)
def operations(
    identifier: UUID, identity: CurrentIdentity, service: Service
) -> dict[str, object]:
    return service.get_operations(identifier)


@router.post(
    "/rentals/{identifier}/handover-preview",
    dependencies=mutation,
    response_model=HandoverPreviewView,
)
def preview(
    identifier: UUID,
    payload: HandoverVersions,
    identity: CurrentIdentity,
    service: Service,
) -> dict[str, object]:
    return service.handover_preview(identifier, payload)


@router.post(
    "/rentals/{identifier}/handover",
    status_code=201,
    dependencies=mutation,
    response_model=OperationsView,
)
def handover(
    identifier: UUID,
    payload: HandoverCommand,
    identity: CurrentIdentity,
    service: Service,
    response: Response,
) -> dict[str, object]:
    return result_status(
        service.execute(identifier, "handover", payload, identity), response
    )


@router.post(
    "/rentals/{identifier}/returns",
    status_code=201,
    dependencies=mutation,
    response_model=OperationsView,
)
def returns(
    identifier: UUID,
    payload: ReturnCommand,
    identity: CurrentIdentity,
    service: Service,
    response: Response,
) -> dict[str, object]:
    return result_status(
        service.execute(identifier, "return", payload, identity), response
    )


@router.post(
    "/rentals/{identifier}/return-forecast",
    status_code=201,
    dependencies=mutation,
    response_model=OperationsView,
)
def forecast(
    identifier: UUID,
    payload: ForecastCommand,
    identity: CurrentIdentity,
    service: Service,
    response: Response,
) -> dict[str, object]:
    return result_status(
        service.execute(identifier, "forecast", payload, identity), response
    )


@router.post(
    "/rentals/{identifier}/incidents/{incident_id}/resolutions",
    status_code=201,
    dependencies=mutation,
    response_model=OperationsView,
)
def resolution(
    identifier: UUID,
    incident_id: UUID,
    payload: ResolutionCommand,
    identity: CurrentIdentity,
    service: Service,
    response: Response,
) -> dict[str, object]:
    return result_status(
        service.execute(identifier, "resolution", payload, identity, incident_id),
        response,
    )


@router.post(
    "/rentals/{identifier}/incidents/{incident_id}/financial-agreements",
    status_code=201,
    dependencies=mutation,
    response_model=OperationsView,
)
def agreement(
    identifier: UUID,
    incident_id: UUID,
    payload: FinancialAgreementCommand,
    identity: CurrentIdentity,
    service: Service,
    response: Response,
) -> dict[str, object]:
    return result_status(
        service.execute(identifier, "agreement", payload, identity, incident_id),
        response,
    )


@router.post(
    "/rentals/{identifier}/close",
    status_code=201,
    dependencies=mutation,
    response_model=OperationsView,
)
def close(
    identifier: UUID,
    payload: OperationalCommand,
    identity: CurrentIdentity,
    service: Service,
    response: Response,
) -> dict[str, object]:
    return result_status(
        service.execute(identifier, "close", payload, identity), response
    )
