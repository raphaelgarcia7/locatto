"""Strict commands; browser versions are preconditions, never authority."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field, model_validator

from rentalops_api.catalog_contracts import CatalogPayload, PositiveQuantity
from rentalops_api.payment_contracts import PaymentView, PositiveMoney
from rentalops_api.quotation_contracts import BusinessDate, QuotationCapacityView
from rentalops_api.rental_contracts import RentalVersions


def explicit_agreement(value: object) -> object:
    if value is not True:
        raise ValueError("Explicit agreement required.")
    return value


Agreed = Annotated[Literal[True], BeforeValidator(explicit_agreement)]


def money_string(value: object) -> object:
    if not isinstance(value, str):
        raise ValueError("Use a two-place decimal string.")
    return value


AgreedMoney = Annotated[PositiveMoney, BeforeValidator(money_string)]


class HandoverVersions(RentalVersions):
    expected_contract_version: int = Field(strict=True, ge=0, le=2_147_483_647)


class OperationalCommand(HandoverVersions):
    request_id: UUID
    reason: str = Field(min_length=1, max_length=1000)


class HandoverLine(CatalogPayload):
    product_id: UUID
    quantity: PositiveQuantity
    condition: str = Field(min_length=1, max_length=1000)


class ThirdParty(CatalogPayload):
    name: str = Field(min_length=1, max_length=200)
    authorization: str = Field(min_length=1, max_length=1000)


class HandoverCommand(OperationalCommand):
    lines: list[HandoverLine] = Field(min_length=1)
    third_party: ThirdParty | None = None
    balance_exception: str | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique_products(self) -> HandoverCommand:
        if len({line.product_id for line in self.lines}) != len(self.lines):
            raise ValueError("Duplicate product.")
        return self


class ReturnLine(CatalogPayload):
    product_id: UUID
    quantity: PositiveQuantity
    condition: Literal["fit", "cleaning", "damaged"]


class ReturnCommand(OperationalCommand):
    business_date: BusinessDate
    lines: list[ReturnLine] = Field(min_length=1)
    observation: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def unique_conditions(self) -> ReturnCommand:
        if len({(line.product_id, line.condition) for line in self.lines}) != len(
            self.lines
        ):
            raise ValueError("Duplicate product condition.")
        return self


class ForecastCommand(OperationalCommand):
    business_date: BusinessDate


class ResolutionCommand(OperationalCommand):
    disposition: Literal["maintenance", "repaired", "released", "lost"]
    quantity: PositiveQuantity
    agreed: Agreed


class FinancialAgreementCommand(OperationalCommand):
    kind: Literal["repair", "replacement", "delay"]
    quantity: PositiveQuantity
    amount: AgreedMoney
    agreed: Agreed


class ContractGateView(BaseModel):
    id: UUID | None
    version: int
    signed: bool
    matches_current_business: bool
    ready_for_pickup: bool
    template_revision: str | None


class SnapshotLineView(BaseModel):
    product_id: UUID
    name: str
    quantity: int
    condition: str


class CustodyLineView(SnapshotLineView):
    received: int
    lost: int
    outstanding: int


class EventView(BaseModel):
    id: UUID
    actor_id: UUID
    created_at: datetime
    reason: str


class HandoverView(EventView):
    business_date: date
    lines: list[SnapshotLineView]
    third_party: ThirdParty | None
    balance_exception: str | None
    contract_id: UUID | None
    contract_version: int | None


class ReturnView(EventView):
    business_date: date
    lines: list[ReturnLine]
    observation: str | None


class ResolutionView(EventView):
    incident_id: UUID
    quantity: int
    disposition: Literal["maintenance", "repaired", "released", "lost"]
    effective_date: date


class AgreementView(EventView):
    incident_id: UUID
    quantity: int
    kind: Literal["repair", "replacement", "delay"]
    amount: str
    financial_version: int
    contract_id: UUID | None
    contract_version: int | None


class ForecastView(EventView):
    business_date: date


class IncidentView(BaseModel):
    id: UUID
    product_id: UUID
    kind: Literal["outstanding", "cleaning", "damaged"]
    quantity: int
    remaining: int
    maintenance_decided: int
    maintenance_id: UUID | None
    received_date: date | None
    reason: str
    actor_id: UUID


class OperationsView(BaseModel):
    rental_id: UUID
    rental_version: int
    quotation_version: int
    financial_version: int
    contract: ContractGateView
    financial: PaymentView
    state: Literal["confirmed", "review", "cancelled", "out", "completed"]
    handover: HandoverView | None
    lines: list[CustodyLineView]
    returns: list[ReturnView]
    incidents: list[IncidentView]
    resolutions: list[ResolutionView]
    agreements: list[AgreementView]
    forecasts: list[ForecastView]
    late: bool
    can_close: bool


class HandoverPreviewView(OperationsView):
    capacity: list[QuotationCapacityView]
    readonly: Literal[True] = True
