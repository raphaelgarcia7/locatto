"""Private contract commands; no prices, business actors or file paths from clients."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from locatto_api.customer_contracts import Address, OptionalText
from locatto_api.quotation_contracts import BusinessDate

Version = Annotated[int, Field(strict=True, ge=0, le=2_147_483_647)]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CompanyFields(Payload):
    name: OptionalText = Field(default=None, max_length=200)
    identification: OptionalText = Field(default=None, max_length=100)
    address: Address = Field(default_factory=Address)
    contact: OptionalText = Field(default=None, max_length=200)


class CompanyCommand(CompanyFields):
    request_id: UUID
    expected_version: Version


class LogoCommand(Payload):
    request_id: UUID
    expected_version: Version
    remove: Annotated[bool, Field(strict=True)] = False


class ContractItemInput(Payload):
    product_id: UUID
    condition: OptionalText = Field(default=None, max_length=1000)
    photo_id: UUID | None = None


class ContractPreview(Payload):
    expected_quotation_version: Annotated[
        int, Field(strict=True, ge=1, le=2_147_483_647)
    ]
    expected_financial_version: Version
    expected_company_version: Version
    expected_rental_version: Version = 0
    expected_contract_version: Version = 0
    template_revision: Literal["pegue-e-monte-v0.4"] = "pegue-e-monte-v0.4"
    event_address: Address = Field(default_factory=Address)
    items: list[ContractItemInput] = Field(default_factory=list, max_length=1000)

    @field_validator("items")
    @classmethod
    def unique_items(cls, value: list[ContractItemInput]) -> list[ContractItemInput]:
        if len({item.product_id for item in value}) != len(value):
            raise ValueError("Duplicate product.")
        return value


class ContractIssue(ContractPreview):
    request_id: UUID


class ContractCommand(Payload):
    request_id: UUID
    expected_contract_version: Annotated[
        int, Field(strict=True, ge=1, le=2_147_483_647)
    ]


class DeliveryCommand(ContractCommand):
    method: Literal["in_person", "email", "messaging", "other"]
    business_date: BusinessDate
    reason: str = Field(min_length=1, max_length=1000)


class SignatureCommand(ContractCommand):
    # Upload and manual review are distinct events, even if requested together.
    reviewed: Annotated[bool, Field(strict=True)] = False
    signed_date: BusinessDate | None = None
    declaration: OptionalText = Field(default=None, max_length=1000)


class SignatureValidation(ContractCommand):
    signed_date: BusinessDate
    declaration: str = Field(min_length=1, max_length=1000)


class ImageSnapshot(Payload):
    id: UUID
    sha256: str
    content_type: str
    storage_key: str | None = None
    content: str  # Frozen base64 pixels, private and never returned in metadata.


class ItemSnapshot(Payload):
    product_id: UUID
    name: str
    quantity: int
    condition: str | None
    photo: ImageSnapshot | None


class ContractSnapshot(Payload):
    quotation_id: UUID
    quotation_version: int
    financial_version: int
    rental_version: int
    company_version: int
    customer_version: int
    template_revision: str
    template_digest: str
    template_text: str
    number: int
    issued_at: str
    company: CompanyFields
    logo: ImageSnapshot | None
    customer_name: str
    customer_cpf: str | None
    customer_rg: str | None
    customer_phone: str
    customer_address: Address
    event_address: Address
    pickup_date: str
    event_date: str
    return_date: str
    pickup_time: str | None
    return_time: str | None
    total: str
    deposit: str
    balance: str
    received: str
    remaining: str
    commercial: dict[str, object] = Field(default_factory=dict)
    financial: dict[str, object] = Field(default_factory=dict)
    items: list[ItemSnapshot]


class PendingField(Payload):
    field: str
    message: str


class CompanyView(CompanyFields):
    version: int
    logo: dict[str, object] | None
    pending: list[str]


class ContractEventView(Payload):
    id: UUID
    kind: Literal["delivery", "signature_upload", "signature_validation"]
    data: dict[str, object]
    actor_id: UUID
    created_at: str


class ContractView(Payload):
    contract_id: UUID
    quotation_id: UUID
    number: int
    current_version: int
    quotation_version: int
    financial_version: int
    rental_version: int
    company_version: int
    template_revision: str
    template_digest: str
    pdf_sha256: str
    state: Literal["issued"]
    delivered: bool
    signature_state: Literal["pending", "awaiting_review", "signed"]
    differences: list[dict[str, object]]
    actor_id: UUID
    created_at: str
    events: list[ContractEventView]


class PreviewView(Payload):
    pending: list[PendingField]
    differences: list[dict[str, object]]
    number: int
    document: str
    sha256: str
    state: Literal["draft"]


class SignatureStateView(Payload):
    quotation_id: UUID
    quotation_version: int
    rental_version: int
    contract: ContractView | None
    matches_current_business: bool
    ready_for_pickup: bool
