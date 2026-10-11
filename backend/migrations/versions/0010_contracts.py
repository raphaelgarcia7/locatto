"""Private immutable contracts and versioned single-company parameters."""

from alembic import op

revision = "0010_contracts"
down_revision = "0009_rental_changes"
branch_labels = None
depends_on = None

TABLES = [
    "company_settings",
    "company_revisions",
    "contract_series",
    "contract_versions",
    "contract_events",
    "contract_requests",
]


def upgrade() -> None:
    op.execute("""CREATE TABLE company_settings (
        id INTEGER PRIMARY KEY, version INTEGER NOT NULL, data JSON NOT NULL,
        logo JSON, CONSTRAINT ck_company_single CHECK (id = 1 AND version >= 1))""")
    op.execute("""CREATE TABLE company_revisions (
        version SERIAL PRIMARY KEY, data JSON NOT NULL, logo JSON,
        actor_id UUID NOT NULL REFERENCES users(id),
        session_id UUID NOT NULL REFERENCES auth_sessions(id),
        changed_fields JSON NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
    op.execute("""CREATE TABLE contract_series (
        id UUID PRIMARY KEY,
        quotation_id UUID NOT NULL UNIQUE REFERENCES quotations(id),
        current_version INTEGER NOT NULL,
        CONSTRAINT ck_contract_series_version CHECK (current_version >= 0))""")
    op.execute("""CREATE TABLE contract_versions (
        series_id UUID NOT NULL REFERENCES contract_series(id),
        number INTEGER NOT NULL, quotation_id UUID NOT NULL,
        quotation_version INTEGER NOT NULL, financial_version INTEGER NOT NULL,
        rental_version INTEGER NOT NULL,
        company_version INTEGER NOT NULL REFERENCES company_revisions(version),
        template_revision VARCHAR(100) NOT NULL, template_digest VARCHAR(64) NOT NULL,
        snapshot JSON NOT NULL, differences JSON NOT NULL,
        storage_key VARCHAR(42) NOT NULL, pdf_size INTEGER NOT NULL,
        pdf_sha256 VARCHAR(64) NOT NULL, state VARCHAR(10) NOT NULL,
        actor_id UUID NOT NULL REFERENCES users(id),
        session_id UUID NOT NULL REFERENCES auth_sessions(id),
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (series_id, number),
        FOREIGN KEY (quotation_id, quotation_version)
            REFERENCES quotation_versions(quotation_id, number),
        CONSTRAINT ck_contract_version CHECK (number >= 1 AND state = 'issued'),
        CONSTRAINT ck_contract_pdf CHECK (
            pdf_size BETWEEN 1 AND 10000000 AND pdf_sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT uq_contract_pdf_key UNIQUE(storage_key))""")
    op.execute("""CREATE TABLE contract_events (
        id UUID PRIMARY KEY, series_id UUID NOT NULL, number INTEGER NOT NULL,
        kind VARCHAR(30) NOT NULL, position INTEGER NOT NULL, data JSON NOT NULL,
        storage_key VARCHAR(42), actor_id UUID NOT NULL REFERENCES users(id),
        session_id UUID NOT NULL REFERENCES auth_sessions(id),
        created_at TIMESTAMPTZ NOT NULL,
        FOREIGN KEY(series_id, number) REFERENCES contract_versions(series_id, number),
        CONSTRAINT ck_contract_event_kind CHECK (
            kind IN ('delivery','signature_upload','signature_validation')),
        CONSTRAINT uq_contract_attachment_key UNIQUE(storage_key),
        CONSTRAINT uq_contract_event_position UNIQUE(series_id,number,position),
        CONSTRAINT ck_contract_event_position CHECK (position >= 1))""")
    op.execute("""CREATE TABLE contract_requests (
        actor_id UUID NOT NULL REFERENCES users(id), operation VARCHAR(120) NOT NULL,
        request_id UUID NOT NULL, payload_hash VARCHAR(64) NOT NULL,
        result JSON NOT NULL, PRIMARY KEY(actor_id, operation, request_id),
        CONSTRAINT ck_contract_request_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$'))""")
    for table in (
        "company_revisions",
        "contract_versions",
        "contract_events",
        "contract_requests",
    ):
        op.execute(
            f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION reject_quotation_mutation()"
        )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
