"""Shared operational preparation, independent of commercial records."""

import sqlalchemy as sa
from alembic import op

revision = "0015_rental_checklists"
down_revision = "0014_kit_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rental_checklists",
        sa.Column(
            "rental_id", sa.Uuid(), sa.ForeignKey("rentals.id"), primary_key=True
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("quotation_version", sa.Integer(), nullable=False),
        sa.Column("extras", sa.JSON(), nullable=False),
        sa.Column("checked_products", sa.JSON(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "session_id", sa.Uuid(), sa.ForeignKey("auth_sessions.id"), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_checklist_version"),
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM rental_checklists")):
        raise RuntimeError("Preserve preparation checklists before downgrading.")
    op.drop_table("rental_checklists")
