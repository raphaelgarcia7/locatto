"""Authenticated, no-store, typed bounded operational reads."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from rentalops_api.auth_routes import CurrentIdentity
from rentalops_api.config import DatabaseSettings
from rentalops_api.customer_routes import private_response
from rentalops_api.dashboard import DashboardService
from rentalops_api.dashboard_contracts import (
    CalendarQuery,
    CalendarView,
    DayQuery,
    DayView,
    UpcomingQuery,
    UpcomingView,
)
from rentalops_api.database import build_engine, build_session_factory

router = APIRouter(
    prefix="/operations",
    tags=["Operations dashboard"],
    dependencies=[Depends(private_response)],
)


def dashboard_service() -> Iterator[DashboardService]:
    engine = build_engine(DatabaseSettings.from_environment())
    try:
        yield DashboardService(build_session_factory(engine))
    finally:
        engine.dispose()


Service = Annotated[DashboardService, Depends(dashboard_service)]


@router.get("/day", response_model=DayView)
def day(
    query: Annotated[DayQuery, Query()], identity: CurrentIdentity, service: Service
) -> dict[str, object]:
    return service.day(query)


@router.get("/calendar", response_model=CalendarView)
def calendar(
    query: Annotated[CalendarQuery, Query()],
    identity: CurrentIdentity,
    service: Service,
) -> dict[str, object]:
    return service.calendar(query)


@router.get("/upcoming", response_model=UpcomingView)
def upcoming(
    query: Annotated[UpcomingQuery, Query()],
    identity: CurrentIdentity,
    service: Service,
) -> dict[str, object]:
    return service.upcoming(query)
