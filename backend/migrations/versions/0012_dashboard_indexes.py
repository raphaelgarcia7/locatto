"""Bound operational date, state and financial-pending lookups."""

from alembic import op

revision = "0012_dashboard_indexes"
down_revision = "0011_handovers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_quotation_versions_pickup",
        "quotation_versions",
        ["pickup_date", "quotation_id", "number"],
    )
    op.create_index(
        "ix_quotation_versions_return",
        "quotation_versions",
        ["return_date", "quotation_id", "number"],
    )
    op.create_index(
        "ix_rentals_operational_state", "rentals", ["state", "quotation_id"]
    )
    op.create_index(
        "ix_payment_accounts_pending",
        "payment_accounts",
        ["requires_reconciliation", "quotation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_payment_accounts_pending", table_name="payment_accounts")
    op.drop_index("ix_rentals_operational_state", table_name="rentals")
    op.drop_index("ix_quotation_versions_return", table_name="quotation_versions")
    op.drop_index("ix_quotation_versions_pickup", table_name="quotation_versions")
