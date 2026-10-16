"""Team preparation notes never change prices, contracts or stock allocations."""

import hashlib
import json
from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from rentalops_api.auth import Identity
from rentalops_api.database import session_scope
from rentalops_api.rental_models import Rental, RentalChecklist, RentalRequest
from rentalops_api.rentals import RentalError


class ChecklistExtra(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: UUID
    label: str = Field(min_length=1, max_length=160)
    checked: bool = False

    @field_validator("label")
    @classmethod
    def printable(cls, value: str) -> str:
        if any(ord(char) < 32 for char in value):
            raise ValueError("Use uma descrição em uma única linha.")
        return value


class ChecklistCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    expected_version: int = Field(ge=0)
    expected_rental_version: int = Field(ge=1)
    checked_products: list[UUID] = Field(max_length=500)
    extras: list[ChecklistExtra] = Field(max_length=100)

    @model_validator(mode="after")
    def unique_items(self) -> ChecklistCommand:
        if len(set(self.checked_products)) != len(self.checked_products) or len(
            {item.id for item in self.extras}
        ) != len(self.extras):
            raise ValueError("Não repita itens no checklist.")
        return self


def checklist_view(rental: Rental, saved: RentalChecklist | None) -> dict[str, object]:
    products: dict[str, dict[str, object]] = {}
    changed = bool(saved and saved.quotation_version != rental.quotation_version)
    checked = set(saved.checked_products if saved and not changed else [])
    for line in cast(list[dict[str, object]], rental.commercial_snapshot["lines"]):
        for item in cast(list[dict[str, object]], line["items"]):
            key = str(item["product_id"])
            row = products.setdefault(
                key,
                {
                    "id": key,
                    "name": item["name"],
                    "quantity": 0,
                    "checked": key in checked,
                },
            )
            row["quantity"] = int(str(row["quantity"])) + int(
                str(item["quantity"])
            ) * int(str(line["quantity"]))
    return {
        "version": saved.version if saved else 0,
        "rental_version": rental.version,
        "needs_recheck": changed,
        "products": list(products.values()),
        "extras": [
            dict(item, checked=False) if changed else item for item in saved.extras
        ]
        if saved
        else [],
        "updated_at": saved.updated_at.isoformat() if saved else None,
    }


class ChecklistService:
    def __init__(self, factory: sessionmaker[Session]) -> None:
        self.factory = factory

    def _rental(
        self, session: Session, identifier: UUID, *, write: bool = False
    ) -> Rental:
        query = (
            select(Rental)
            .where(Rental.id == identifier)
            .with_for_update(read=not write)
        )
        rental = session.scalar(query)
        if rental is None:
            raise RentalError(404, "not_found", "Locação não encontrada.")
        if rental.state not in {"confirmed", "out", "completed"}:
            raise RentalError(
                409,
                "not_confirmed",
                "Confirme a reserva antes de preparar os materiais.",
            )
        return rental

    def get(self, identifier: UUID) -> dict[str, object]:
        return self.snapshot(identifier)[1]

    def snapshot(self, identifier: UUID) -> tuple[dict[str, object], dict[str, object]]:
        with session_scope(self.factory) as session:
            rental = self._rental(session, identifier)
            return rental.commercial_snapshot, checklist_view(
                rental, session.get(RentalChecklist, identifier)
            )

    def save(
        self, identifier: UUID, payload: ChecklistCommand, identity: Identity
    ) -> tuple[dict[str, object], bool]:
        operation = f"checklist:{identifier}"
        digest = hashlib.sha256(
            json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()
        lock = int.from_bytes(
            hashlib.sha256(
                f"{identity.user_id}:{operation}:{payload.request_id}".encode()
            ).digest()[:8],
            "big",
            signed=True,
        )
        with session_scope(self.factory) as session:
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
            previous = session.get(
                RentalRequest, (identity.user_id, operation, payload.request_id)
            )
            if previous:
                if previous.payload_hash != digest:
                    raise RentalError(
                        409,
                        "idempotency_conflict",
                        "Esta operação já foi usada com outro conteúdo.",
                    )
                return cast(dict[str, object], previous.result["view"]), True
            rental = self._rental(session, identifier, write=True)
            saved = session.get(RentalChecklist, identifier)
            if (
                (saved.version if saved else 0) != payload.expected_version
                or rental.version != payload.expected_rental_version
            ):
                raise RentalError(
                    409,
                    "version_conflict",
                    "O checklist ou a locação mudou. Recarregue antes de salvar.",
                )
            view = checklist_view(rental, saved)
            allowed = {
                str(item["id"])
                for item in cast(list[dict[str, object]], view["products"])
            }
            if any(str(item) not in allowed for item in payload.checked_products):
                raise RentalError(
                    422, "invalid_product", "Confira somente os produtos desta locação."
                )
            if saved is None:
                saved = RentalChecklist(rental_id=identifier, version=0)
                session.add(saved)
            saved.version += 1
            saved.quotation_version = rental.quotation_version
            saved.checked_products = [str(item) for item in payload.checked_products]
            saved.extras = [item.model_dump(mode="json") for item in payload.extras]
            saved.actor_id, saved.session_id = identity.user_id, identity.session_id
            saved.updated_at = datetime.now(UTC)
            result = checklist_view(rental, saved)
            session.add(
                RentalRequest(
                    actor_id=identity.user_id,
                    operation=operation,
                    request_id=payload.request_id,
                    payload_hash=digest,
                    status=201,
                    result={"view": result, "session_id": str(identity.session_id)},
                )
            )
            session.commit()
            return result, False
