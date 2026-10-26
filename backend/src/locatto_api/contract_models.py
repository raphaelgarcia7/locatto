"""Private immutable document revisions and separate delivery/signature events."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from locatto_api.models import Base


class CompanySettings(Base):
    __tablename__ = "company_settings"
    __table_args__ = (
        CheckConstraint("id = 1 AND version >= 1", name="ck_company_single"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict[str, object]] = mapped_column(JSON)
    logo: Mapped[dict[str, object] | None] = mapped_column(JSON)


class CompanyRevision(Base):
    __tablename__ = "company_revisions"
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict[str, object]] = mapped_column(JSON)
    logo: Mapped[dict[str, object] | None] = mapped_column(JSON)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[UUID] = mapped_column(ForeignKey("auth_sessions.id"))
    changed_fields: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class ContractSeries(Base):
    __tablename__ = "contract_series"
    __table_args__ = (
        CheckConstraint("current_version >= 0", name="ck_contract_series_version"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    quotation_id: Mapped[UUID] = mapped_column(ForeignKey("quotations.id"), unique=True)
    current_version: Mapped[int] = mapped_column(Integer, default=0)


class ContractVersion(Base):
    __tablename__ = "contract_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["quotation_id", "quotation_version"],
            ["quotation_versions.quotation_id", "quotation_versions.number"],
        ),
        CheckConstraint("number >= 1 AND state = 'issued'", name="ck_contract_version"),
        CheckConstraint(
            "pdf_size BETWEEN 1 AND 10000000 AND pdf_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_contract_pdf",
        ),
        UniqueConstraint("storage_key", name="uq_contract_pdf_key"),
    )
    series_id: Mapped[UUID] = mapped_column(
        ForeignKey("contract_series.id"), primary_key=True
    )
    number: Mapped[int] = mapped_column(Integer, primary_key=True)
    quotation_id: Mapped[UUID] = mapped_column(Uuid)
    quotation_version: Mapped[int] = mapped_column(Integer)
    financial_version: Mapped[int] = mapped_column(Integer)
    rental_version: Mapped[int] = mapped_column(Integer)
    company_version: Mapped[int] = mapped_column(
        ForeignKey("company_revisions.version")
    )
    template_revision: Mapped[str] = mapped_column(String(100))
    template_digest: Mapped[str] = mapped_column(String(64))
    snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    differences: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    storage_key: Mapped[str] = mapped_column(String(42))
    pdf_size: Mapped[int] = mapped_column(Integer)
    pdf_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(10), default="issued")
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[UUID] = mapped_column(ForeignKey("auth_sessions.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ContractEvent(Base):
    __tablename__ = "contract_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["series_id", "number"],
            ["contract_versions.series_id", "contract_versions.number"],
        ),
        CheckConstraint(
            "kind IN ('delivery','signature_upload','signature_validation')",
            name="ck_contract_event_kind",
        ),
        UniqueConstraint("storage_key", name="uq_contract_attachment_key"),
        UniqueConstraint(
            "series_id", "number", "position", name="uq_contract_event_position"
        ),
        CheckConstraint("position >= 1", name="ck_contract_event_position"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    series_id: Mapped[UUID] = mapped_column(Uuid)
    number: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30))
    position: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict[str, object]] = mapped_column(JSON)
    storage_key: Mapped[str | None] = mapped_column(String(42))
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[UUID] = mapped_column(ForeignKey("auth_sessions.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ContractRequest(Base):
    __tablename__ = "contract_requests"
    __table_args__ = (
        CheckConstraint(
            "payload_hash ~ '^[0-9a-f]{64}$'", name="ck_contract_request_hash"
        ),
    )
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    operation: Mapped[str] = mapped_column(String(120), primary_key=True)
    request_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, object]] = mapped_column(JSON)
