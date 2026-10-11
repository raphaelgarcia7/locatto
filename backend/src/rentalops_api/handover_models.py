"""Physical custody snapshots and explicit, private operational decisions."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from rentalops_api.models import Base


class OperationalEvent:
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    rental_id: Mapped[UUID] = mapped_column(ForeignKey("rentals.id"), index=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[UUID] = mapped_column(ForeignKey("auth_sessions.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str] = mapped_column(String(1000))


class Handover(OperationalEvent, Base):
    __tablename__ = "handovers"
    __table_args__ = (
        CheckConstraint("contract_version >= 1", name="ck_handover_contract"),
        ForeignKeyConstraint(
            ["contract_id", "contract_version"],
            ["contract_versions.series_id", "contract_versions.number"],
        ),
    )
    rental_id: Mapped[UUID] = mapped_column(ForeignKey("rentals.id"), unique=True)
    business_date: Mapped[date] = mapped_column(Date)
    contract_id: Mapped[UUID] = mapped_column(ForeignKey("contract_series.id"))
    contract_version: Mapped[int] = mapped_column(Integer)
    lines: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    third_party: Mapped[dict[str, object] | None] = mapped_column(JSON)
    balance_exception: Mapped[str | None] = mapped_column(String(1000))


class ReturnEvent(OperationalEvent, Base):
    __tablename__ = "return_events"
    business_date: Mapped[date] = mapped_column(Date)
    lines: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    observation: Mapped[str | None] = mapped_column(String(2000))


class Incident(OperationalEvent, Base):
    __tablename__ = "rental_incidents"
    __table_args__ = (
        CheckConstraint("quantity BETWEEN 1 AND 2147483647", name="ck_incident_qty"),
        CheckConstraint(
            "kind IN ('outstanding','cleaning','damaged')", name="ck_incident_kind"
        ),
        CheckConstraint(
            "(kind = 'outstanding' AND return_event_id IS NULL "
            "AND maintenance_id IS NULL AND received_date IS NULL) OR "
            "(kind IN ('cleaning','damaged') AND return_event_id IS NOT NULL "
            "AND maintenance_id IS NOT NULL AND received_date IS NOT NULL)",
            name="ck_incident_origin",
        ),
        UniqueConstraint(
            "rental_id",
            "product_id",
            "return_event_id",
            "kind",
            name="uq_incident_origin",
            postgresql_nulls_not_distinct=True,
        ),
    )
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    return_event_id: Mapped[UUID | None] = mapped_column(ForeignKey("return_events.id"))
    maintenance_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("maintenance_entries.id"), unique=True
    )
    received_date: Mapped[date | None] = mapped_column(Date)


class IncidentResolution(OperationalEvent, Base):
    __tablename__ = "incident_resolutions"
    __table_args__ = (
        CheckConstraint("quantity BETWEEN 1 AND 2147483647", name="ck_resolution_qty"),
        CheckConstraint(
            "disposition IN ('maintenance','repaired','released','lost')",
            name="ck_resolution_kind",
        ),
    )
    incident_id: Mapped[UUID] = mapped_column(
        ForeignKey("rental_incidents.id"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer)
    disposition: Mapped[str] = mapped_column(String(20))
    effective_date: Mapped[date] = mapped_column(Date)


class FinancialAgreement(OperationalEvent, Base):
    __tablename__ = "incident_financial_agreements"
    __table_args__ = (
        ForeignKeyConstraint(
            ["contract_id", "contract_version"],
            ["contract_versions.series_id", "contract_versions.number"],
        ),
        CheckConstraint("quantity BETWEEN 1 AND 2147483647", name="ck_agreement_qty"),
        CheckConstraint(
            "amount > 0 AND amount <= 9999999999.99", name="ck_agreement_amount"
        ),
        CheckConstraint(
            "kind IN ('repair','replacement','delay')", name="ck_agreement_kind"
        ),
    )
    incident_id: Mapped[UUID] = mapped_column(
        ForeignKey("rental_incidents.id"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    financial_version: Mapped[int] = mapped_column(Integer)
    contract_id: Mapped[UUID] = mapped_column(ForeignKey("contract_series.id"))
    contract_version: Mapped[int] = mapped_column(Integer)


class ReturnForecast(OperationalEvent, Base):
    __tablename__ = "return_forecasts"
    business_date: Mapped[date] = mapped_column(Date)
