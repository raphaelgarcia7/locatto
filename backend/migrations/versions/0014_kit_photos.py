"""Allow private catalog photos to belong to either a product or a kit."""

import sqlalchemy as sa
from alembic import op

revision = "0014_kit_photos"
down_revision = "0013_product_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product_photos", sa.Column("kit_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_photo_kit", "product_photos", "kits", ["kit_id"], ["id"])
    op.alter_column("product_photos", "product_id", nullable=True)
    op.create_check_constraint(
        "ck_photo_owner",
        "product_photos",
        "(product_id IS NOT NULL) <> (kit_id IS NOT NULL)",
    )
    op.create_index("ix_product_photos_kit_id", "product_photos", ["kit_id"])
    op.create_index(
        "uq_kit_principal_photo",
        "product_photos",
        ["kit_id"],
        unique=True,
        postgresql_where=sa.text("is_principal AND is_attached"),
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM product_photos WHERE kit_id IS NOT NULL")
    ):
        raise RuntimeError(
            "Kit photos exist; preserve their metadata before downgrading."
        )
    op.drop_index("uq_kit_principal_photo", table_name="product_photos")
    op.drop_index("ix_product_photos_kit_id", table_name="product_photos")
    op.drop_constraint("ck_photo_owner", "product_photos", type_="check")
    op.alter_column("product_photos", "product_id", nullable=False)
    op.drop_constraint("fk_photo_kit", "product_photos", type_="foreignkey")
    op.drop_column("product_photos", "kit_id")
