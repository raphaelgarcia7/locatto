"""Bounded private operational read contracts, shared by all three views."""

import re
from datetime import date as Date
from datetime import datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from locatto_api.quotation_contracts import BusinessDate

OperationalState = Literal["confirmed", "cancelled", "review", "out", "completed"]
QueueKind = Literal["pickup", "return", "overdue", "debt", "occurrence"]


def query_integer(value: object) -> object:
    if isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,9}", value):
        return int(value)
    return value


def query_boolean(value: object) -> object:
    if value in ("true", "false"):
        return value == "true"
    return value


PageNumber = Annotated[
    int, BeforeValidator(query_integer), Field(strict=True, ge=1, le=2_147_483_647)
]
PageSize = Annotated[
    int, BeforeValidator(query_integer), Field(strict=True, ge=1, le=100)
]


class DashboardFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operational_state: OperationalState | None = None
    financial_pending: (
        Annotated[bool, Field(strict=True), BeforeValidator(query_boolean)] | None
    ) = None
    customer_id: UUID | None = None


class DayQuery(DashboardFilters):
    date: BusinessDate | None = None
    queue: QueueKind | None = None
    page: PageNumber = 1
    page_size: PageSize = 50


class CalendarQuery(DashboardFilters):
    month: str = Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")

    @model_validator(mode="after")
    def supported_month(self) -> CalendarQuery:
        Date.fromisoformat(f"{self.month}-01")
        return self


class UpcomingQuery(DashboardFilters):
    from_date: BusinessDate | None = Field(default=None, alias="from")
    to_date: BusinessDate | None = Field(default=None, alias="to")
    page: PageNumber = 1
    page_size: PageSize = 50

    def period(self, today: Date) -> tuple[Date, Date]:
        start = self.from_date or today
        end = self.to_date or start + timedelta(days=29)
        if end < start or (end - start).days >= 90:
            raise ValueError("Use a period of one through 90 calendar days.")
        return start, end

    @model_validator(mode="after")
    def bounded_period(self) -> UpcomingQuery:
        if self.from_date and self.to_date:
            self.period(self.from_date)
        return self


class FinancialSummary(BaseModel):
    remaining: str
    extra_agreed: str
    operational_debt: str
    unallocated_received: str
    requires_reconciliation: bool
    pending: bool


class DashboardRow(BaseModel):
    rental_id: UUID
    quotation_id: UUID
    customer_id: UUID
    customer_display_name: str
    kind: QueueKind
    date: Date
    optional_time: str | None
    operational_state: OperationalState
    financial_summary: FinancialSummary
    occurrence_count: int
    outstanding_qty: int
    pickup_date: Date
    return_date: Date
    current_return_forecast: Date
    actual_pickup_date: Date | None
    last_actual_return_date: Date | None


class DashboardPage(BaseModel):
    items: list[DashboardRow]
    total: int
    page: int
    page_size: int


class DayView(BaseModel):
    date: Date
    timezone: Literal["America/Sao_Paulo"]
    checked_at: datetime
    queues: dict[QueueKind, DashboardPage]


class CalendarDay(BaseModel):
    date: Date
    pickup: int
    returns: int


class CalendarView(BaseModel):
    month: str
    timezone: Literal["America/Sao_Paulo"]
    checked_at: datetime
    days: list[CalendarDay]


class UpcomingView(DashboardPage):
    from_date: Date
    to_date: Date
    timezone: Literal["America/Sao_Paulo"]
    checked_at: datetime
