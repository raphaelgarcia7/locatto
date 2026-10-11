"""Physical custody, return events and explicit incident decisions."""

from alembic import op

revision = "0011_handovers"
down_revision = "0010_contracts"
branch_labels = None
depends_on = None

EVENT_COLUMNS = """id UUID PRIMARY KEY,
    rental_id UUID NOT NULL REFERENCES rentals(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    session_id UUID NOT NULL REFERENCES auth_sessions(id),
    created_at TIMESTAMPTZ NOT NULL, reason VARCHAR(1000) NOT NULL"""
TABLES = (
    "handovers",
    "return_events",
    "rental_incidents",
    "incident_resolutions",
    "incident_financial_agreements",
    "return_forecasts",
)


def upgrade() -> None:
    op.execute("ALTER TABLE rentals DROP CONSTRAINT ck_rental_state")
    op.execute("""ALTER TABLE rentals ADD CONSTRAINT ck_rental_state CHECK
        (version >= 1 AND state IN
            ('confirmed','cancelled','review','out','completed'))""")
    definitions = {
        "handovers": """business_date DATE NOT NULL,
            contract_id UUID NOT NULL REFERENCES contract_series(id),
            contract_version INTEGER NOT NULL, lines JSON NOT NULL,
            third_party JSON, balance_exception VARCHAR(1000),
            UNIQUE(rental_id),
            CONSTRAINT ck_handover_contract CHECK(contract_version >= 1),
            FOREIGN KEY(contract_id, contract_version)
                REFERENCES contract_versions(series_id, number)""",
        "return_events": """business_date DATE NOT NULL, lines JSON NOT NULL,
            observation VARCHAR(2000)""",
        "rental_incidents": """product_id UUID NOT NULL REFERENCES products(id),
            quantity INTEGER NOT NULL, kind VARCHAR(20) NOT NULL,
            return_event_id UUID REFERENCES return_events(id),
            maintenance_id UUID UNIQUE REFERENCES maintenance_entries(id),
            received_date DATE,
            CONSTRAINT ck_incident_qty CHECK(quantity BETWEEN 1 AND 2147483647),
            CONSTRAINT ck_incident_kind
                CHECK(kind IN ('outstanding','cleaning','damaged')),
            CONSTRAINT ck_incident_origin CHECK(
                (kind = 'outstanding' AND return_event_id IS NULL
                    AND maintenance_id IS NULL AND received_date IS NULL) OR
                (kind IN ('cleaning','damaged') AND return_event_id IS NOT NULL
                    AND maintenance_id IS NOT NULL AND received_date IS NOT NULL)),
            CONSTRAINT uq_incident_origin
                UNIQUE NULLS NOT DISTINCT
                    (rental_id, product_id, return_event_id, kind)""",
        "incident_resolutions": """
            incident_id UUID NOT NULL REFERENCES rental_incidents(id),
            quantity INTEGER NOT NULL, disposition VARCHAR(20) NOT NULL,
            effective_date DATE NOT NULL,
            CONSTRAINT ck_resolution_qty CHECK(quantity BETWEEN 1 AND 2147483647),
            CONSTRAINT ck_resolution_kind
                CHECK(disposition IN ('maintenance','repaired','released','lost'))""",
        "incident_financial_agreements": """
            incident_id UUID NOT NULL REFERENCES rental_incidents(id),
            quantity INTEGER NOT NULL, kind VARCHAR(20) NOT NULL,
            amount NUMERIC(12,2) NOT NULL,
            financial_version INTEGER NOT NULL,
            contract_id UUID NOT NULL REFERENCES contract_series(id),
            contract_version INTEGER NOT NULL,
            FOREIGN KEY(contract_id, contract_version)
                REFERENCES contract_versions(series_id, number),
            CONSTRAINT ck_agreement_qty CHECK(quantity BETWEEN 1 AND 2147483647),
            CONSTRAINT ck_agreement_amount
                CHECK(amount > 0 AND amount <= 9999999999.99),
            CONSTRAINT ck_agreement_kind
                CHECK(kind IN ('repair','replacement','delay'))""",
        "return_forecasts": "business_date DATE NOT NULL",
    }
    for table in TABLES:
        op.execute(f"CREATE TABLE {table} ({EVENT_COLUMNS}, {definitions[table]})")
        if table != "handovers":
            op.execute(f"CREATE INDEX ix_{table}_rental_id ON {table}(rental_id)")
        op.execute(f"""CREATE TRIGGER {table}_immutable
            BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION reject_quotation_mutation()""")
    for table in ("incident_resolutions", "incident_financial_agreements"):
        op.execute(f"CREATE INDEX ix_{table}_incident_id ON {table}(incident_id)")


def downgrade() -> None:
    op.execute("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM handovers) THEN
        RAISE EXCEPTION 'Preserve physical custody history before downgrade';
        END IF; END; $$""")
    for table in reversed(TABLES):
        op.execute(f"DROP TABLE {table}")
    op.execute("ALTER TABLE rentals DROP CONSTRAINT ck_rental_state")
    op.execute("""ALTER TABLE rentals ADD CONSTRAINT ck_rental_state CHECK
        (version >= 1 AND state IN ('confirmed','cancelled','review'))""")
