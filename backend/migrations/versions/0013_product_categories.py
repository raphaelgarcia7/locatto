"""Registered product categories, retaining the existing category display contract."""

import sqlalchemy as sa
from alembic import op

revision = "0013_product_categories"
down_revision = "0012_dashboard_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_categories",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "name = btrim(name) AND length(name) BETWEEN 1 AND 100",
            name="ck_category_name",
        ),
    )
    op.execute("""
        INSERT INTO product_categories (id, name)
        SELECT gen_random_uuid(), min(btrim(category)) FROM products
        WHERE category IS NOT NULL AND btrim(category) <> ''
        GROUP BY lower(btrim(category))
    """)
    op.create_index(
        "uq_category_name_folded",
        "product_categories",
        [sa.text("lower(name)")],
        unique=True,
    )
    # Consolidate spelling/case only; historical audit snapshots remain immutable.
    op.execute("""
        UPDATE products SET category = (
            SELECT name FROM product_categories
            WHERE lower(name) = lower(btrim(products.category))
        ) WHERE category IS NOT NULL
    """)
    op.create_foreign_key(
        "fk_product_category", "products", "product_categories", ["category"], ["name"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_product_category", "products", type_="foreignkey")
    op.drop_table("product_categories")
