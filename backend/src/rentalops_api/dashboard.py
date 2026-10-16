"""Private read-only PG snapshot. No business writes or per-rental queries.

The projection deliberately selects scalar summaries, never commercial lines,
documents, receipts, photos, notes or customer identification/contact fields.
Current payment applications follow #12; physical quantities/open incidents
follow #14, including maintenance decisions and formal outstanding losses.
"""

import calendar
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from rentalops_api.dashboard_contracts import (
    CalendarQuery,
    DashboardFilters,
    DayQuery,
    UpcomingQuery,
)
from rentalops_api.quotation_contracts import SAO_PAULO
from rentalops_api.rentals import RentalError

# One shared relational selection for day, calendar and upcoming. All monetary
# applications are taken from the current financial revision, never a stale
# confirmation snapshot. JSON expansion is confined to physical quantity facts.
PROJECTION = """
WITH applications AS (
 SELECT a.quotation_id, a.financial_version,
        sum(a.deposit + a.balance) AS applied
 FROM payment_allocations a GROUP BY a.quotation_id, a.financial_version
), money_received AS (
 SELECT r.quotation_id, sum(v.amount) AS amount
 FROM payment_receipts r JOIN payment_receipt_revisions v
 ON v.receipt_id=r.id AND v.number=r.revision GROUP BY r.quotation_id
), refunds AS (
 SELECT quotation_id, sum(amount) AS amount FROM payment_refunds GROUP BY quotation_id
), extras AS (
 SELECT rental_id, sum(amount) AS amount FROM incident_financial_agreements
 GROUP BY rental_id
), received AS (
 SELECT e.rental_id, line->>'product_id' AS product_id,
        sum((line->>'quantity')::bigint) AS quantity
 FROM return_events e CROSS JOIN LATERAL json_array_elements(e.lines) line
 GROUP BY e.rental_id, line->>'product_id'
), decisions AS (
 SELECT incident_id,
 sum(quantity) FILTER (WHERE disposition<>'maintenance') AS physical,
 sum(quantity) FILTER (WHERE disposition='maintenance') AS accounted,
 sum(quantity) FILTER (WHERE disposition='lost') AS lost
 FROM incident_resolutions GROUP BY incident_id
), missing_losses AS (
 SELECT i.rental_id, sum(d.lost) AS quantity
 FROM rental_incidents i JOIN decisions d ON d.incident_id=i.id
 WHERE i.kind='outstanding' GROUP BY i.rental_id
), open_incidents AS (
 SELECT i.rental_id, count(*) AS quantity FROM rental_incidents i
 LEFT JOIN decisions d ON d.incident_id=i.id
 LEFT JOIN received r ON r.rental_id=i.rental_id
 AND r.product_id=i.product_id::text
 WHERE i.quantity - coalesce(d.physical,0)
 - CASE WHEN i.kind='outstanding' THEN coalesce(r.quantity,0)
        ELSE coalesce(d.accounted,0) END > 0
 GROUP BY i.rental_id
), sent AS (
 SELECT h.rental_id, sum((line->>'quantity')::bigint) AS quantity
 FROM handovers h CROSS JOIN LATERAL json_array_elements(h.lines) line
 GROUP BY h.rental_id
), total_received AS (
 SELECT rental_id, sum(quantity) AS quantity FROM received GROUP BY rental_id
), latest_forecast AS (
 SELECT DISTINCT ON (rental_id) rental_id, business_date
 FROM return_forecasts ORDER BY rental_id, created_at DESC, id DESC
), actual_return AS (
 SELECT rental_id, max(business_date) AS business_date FROM return_events
 GROUP BY rental_id
), facts AS (
 SELECT r.id AS rental_id, r.quotation_id, q.customer_id,
 c.name AS customer_display_name, r.state AS operational_state,
 q.created_at, v.pickup_date, v.return_date,
 r.commercial_snapshot->>'pickup_time' AS pickup_time,
 r.commercial_snapshot->>'return_time' AS return_time,
 coalesce(f.business_date,v.return_date) AS current_return_forecast,
 h.business_date AS actual_pickup_date, ar.business_date AS last_actual_return_date,
 greatest(0,coalesce(s.quantity,0)-coalesce(tr.quantity,0)-coalesce(ml.quantity,0))
 AS outstanding_qty, coalesce(oi.quantity,0) AS occurrence_count,
 greatest(0,cv.total - CASE WHEN pa.reconciled_quotation_version=q.current_version
 THEN coalesce(a.applied,0) ELSE 0 END) AS remaining,
 coalesce(x.amount,0) AS extra_agreed,
 coalesce(m.amount,0)-coalesce(ref.amount,0)
 - CASE WHEN pa.reconciled_quotation_version=q.current_version
 THEN coalesce(a.applied,0) ELSE 0 END AS unallocated_received,
 coalesce(pa.requires_reconciliation,false) OR
 (pa.reconciled_quotation_version IS NOT NULL
 AND pa.reconciled_quotation_version<>q.current_version) AS account_reconciliation
 FROM rentals r JOIN quotations q ON q.id=r.quotation_id
 JOIN quotation_versions v ON v.quotation_id=q.id AND v.number=r.quotation_version
 JOIN quotation_versions cv ON cv.quotation_id=q.id AND cv.number=q.current_version
 JOIN customers c ON c.id=q.customer_id
 LEFT JOIN payment_accounts pa ON pa.quotation_id=q.id
 LEFT JOIN applications a ON a.quotation_id=q.id AND a.financial_version=pa.version
 LEFT JOIN money_received m ON m.quotation_id=q.id
 LEFT JOIN refunds ref ON ref.quotation_id=q.id
 LEFT JOIN extras x ON x.rental_id=r.id
 LEFT JOIN handovers h ON h.rental_id=r.id
 LEFT JOIN sent s ON s.rental_id=r.id
 LEFT JOIN total_received tr ON tr.rental_id=r.id
 LEFT JOIN missing_losses ml ON ml.rental_id=r.id
 LEFT JOIN open_incidents oi ON oi.rental_id=r.id
 LEFT JOIN latest_forecast f ON f.rental_id=r.id
 LEFT JOIN actual_return ar ON ar.rental_id=r.id
), filtered AS (
 SELECT *, remaining+extra_agreed AS operational_debt,
 account_reconciliation OR unallocated_received>0 AS requires_reconciliation,
 remaining+extra_agreed>0
 AS financial_pending FROM facts
 WHERE (CAST(:state AS text) IS NULL OR operational_state=:state)
 AND (CAST(:customer AS uuid) IS NULL OR customer_id=CAST(:customer AS uuid))
), selected AS (
 SELECT * FROM filtered WHERE CAST(:financial AS boolean) IS NULL
 OR financial_pending=CAST(:financial AS boolean)
), events AS (
 SELECT *, 'pickup' AS kind, pickup_date AS date, pickup_time AS optional_time
 FROM selected WHERE operational_state='confirmed'
 UNION ALL
 SELECT *, 'return', current_return_forecast,
 CASE WHEN current_return_forecast=return_date THEN return_time ELSE NULL END
 FROM selected WHERE operational_state='confirmed'
 OR (operational_state='out' AND outstanding_qty>0)
 UNION ALL
 SELECT *, 'overdue', return_date, return_time FROM selected
 WHERE operational_state='out' AND outstanding_qty>0 AND return_date<:day
 UNION ALL
 SELECT *, 'debt', pickup_date, pickup_time FROM selected WHERE financial_pending
 UNION ALL
 SELECT *, 'occurrence', return_date, return_time FROM selected WHERE occurrence_count>0
)
"""
ORDER = "date, optional_time NULLS LAST, created_at, rental_id, kind"
KINDS = ("pickup", "return", "overdue", "debt", "occurrence")


def row_view(row: Mapping[str, object]) -> dict[str, object]:
    values = {
        key: row[key]
        for key in (
            "rental_id",
            "quotation_id",
            "customer_id",
            "customer_display_name",
            "kind",
            "date",
            "optional_time",
            "operational_state",
            "occurrence_count",
            "outstanding_qty",
            "pickup_date",
            "return_date",
            "current_return_forecast",
            "actual_pickup_date",
            "last_actual_return_date",
        )
    }
    values["financial_summary"] = {
        **{
            key: format(Decimal(str(row[key])), ".2f")
            for key in (
                "remaining",
                "extra_agreed",
                "operational_debt",
                "unallocated_received",
            )
        },
        "requires_reconciliation": row["requires_reconciliation"],
        "pending": row["financial_pending"],
    }
    return values


class DashboardService:
    def __init__(
        self,
        factory: sessionmaker[Session],
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.factory = factory
        self.clock = clock

    @contextmanager
    def snapshot(self) -> Iterator[Session]:
        with self.factory() as session:
            session.execute(
                text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            )
            yield session

    def parameters(self, query: DashboardFilters, day: date) -> dict[str, object]:
        return {
            "state": query.operational_state,
            "customer": str(query.customer_id) if query.customer_id else None,
            "financial": query.financial_pending,
            "day": day,
        }

    def page(
        self,
        session: Session,
        params: dict[str, object],
        condition: str,
        page: int,
        page_size: int,
    ) -> dict[str, object]:
        total = session.scalar(
            text(PROJECTION + " SELECT count(*) FROM events WHERE " + condition), params
        )
        rows = session.execute(
            text(
                PROJECTION
                + " SELECT * FROM events WHERE "
                + condition
                + f" ORDER BY {ORDER} LIMIT :limit OFFSET :offset"
            ),
            {**params, "limit": page_size, "offset": (page - 1) * page_size},
        ).mappings()
        return {
            "items": [row_view(dict(row)) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def day(self, query: DayQuery) -> dict[str, object]:
        checked = self.clock()
        day = query.date or checked.astimezone(SAO_PAULO).date()
        params = self.parameters(query, day)
        with self.snapshot() as session:
            queues = {}
            for kind in KINDS:
                condition = "kind=:kind"
                if kind in {"pickup", "return"}:
                    condition += " AND date=:day"
                queues[kind] = self.page(
                    session,
                    {**params, "kind": kind},
                    condition,
                    query.page if query.queue == kind else 1,
                    query.page_size,
                )
            return {
                "date": day,
                "timezone": "America/Sao_Paulo",
                "checked_at": checked,
                "queues": queues,
            }

    def calendar(self, query: CalendarQuery) -> dict[str, object]:
        checked = self.clock()
        first = date.fromisoformat(f"{query.month}-01")
        last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        params = {
            **self.parameters(query, checked.astimezone(SAO_PAULO).date()),
            "start": first,
            "end": last,
        }
        with self.snapshot() as session:
            counts = session.execute(
                text(
                    PROJECTION
                    + """
                SELECT date, count(*) FILTER (WHERE kind='pickup') AS pickup,
                count(*) FILTER (WHERE kind='return') AS returns FROM events
                WHERE kind IN ('pickup','return') AND date BETWEEN :start AND :end
                GROUP BY date ORDER BY date
            """
                ),
                params,
            ).mappings()
            by_day = {row["date"]: dict(row) for row in counts}
            days = [
                by_day.get(
                    first.replace(day=number),
                    {
                        "date": first.replace(day=number),
                        "pickup": 0,
                        "returns": 0,
                    },
                )
                for number in range(1, last.day + 1)
            ]
            return {
                "month": query.month,
                "timezone": "America/Sao_Paulo",
                "checked_at": checked,
                "days": days,
            }

    def upcoming(self, query: UpcomingQuery) -> dict[str, object]:
        checked = self.clock()
        today = checked.astimezone(SAO_PAULO).date()
        try:
            start, end = query.period(today)
        except ValueError, OverflowError:
            raise RentalError(
                422, "invalid_period", "Escolha um período de 1 a 90 dias."
            ) from None
        params = {**self.parameters(query, today), "start": start, "end": end}
        with self.snapshot() as session:
            result = self.page(
                session,
                params,
                "kind IN ('pickup','return') AND date BETWEEN :start AND :end",
                query.page,
                query.page_size,
            )
            return {
                **result,
                "from_date": start,
                "to_date": end,
                "timezone": "America/Sao_Paulo",
                "checked_at": checked,
            }
