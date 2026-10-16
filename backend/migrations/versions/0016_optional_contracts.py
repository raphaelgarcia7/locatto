"""Optional contract references for physical custody and manual agreements."""

import sqlalchemy as sa
from alembic import op

revision = "0016_optional_contracts"
down_revision = "0015_rental_checklists"
branch_labels = None
depends_on = None

PAIR = (
    "(contract_id IS NULL AND contract_version IS NULL) OR "
    "(contract_id IS NOT NULL AND contract_version IS NOT NULL "
    "AND contract_version >= 1)"
)


def upgrade() -> None:
    op.drop_constraint("ck_handover_contract", "handovers", type_="check")
    for table in ("handovers", "incident_financial_agreements"):
        op.alter_column(table, "contract_id", existing_type=sa.Uuid(), nullable=True)
        op.alter_column(
            table, "contract_version", existing_type=sa.Integer(), nullable=True
        )
    op.create_check_constraint("ck_handover_contract", "handovers", PAIR)
    op.create_check_constraint(
        "ck_agreement_contract", "incident_financial_agreements", PAIR
    )


def downgrade() -> None:
    for table in ("handovers", "incident_financial_agreements"):
        if op.get_bind().scalar(
            sa.text(
                f"SELECT count(*) FROM {table} "
                "WHERE contract_id IS NULL OR contract_version IS NULL"
            )
        ):
            raise RuntimeError(
                "Preserve operations without contracts before downgrading."
            )
    op.drop_constraint("ck_handover_contract", "handovers", type_="check")
    op.drop_constraint(
        "ck_agreement_contract", "incident_financial_agreements", type_="check"
    )
    for table in ("handovers", "incident_financial_agreements"):
        op.alter_column(table, "contract_id", existing_type=sa.Uuid(), nullable=False)
        op.alter_column(
            table, "contract_version", existing_type=sa.Integer(), nullable=False
        )
    op.create_check_constraint(
        "ck_handover_contract", "handovers", "contract_version >= 1"
    )
