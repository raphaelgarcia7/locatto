"""Daily capacity by simultaneous segments, shared by quotations and rentals."""

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from rentalops_api.catalog_models import Product
from rentalops_api.handover_models import (
    Handover,
    Incident,
    IncidentResolution,
    ReturnEvent,
)
from rentalops_api.quotation_contracts import SAO_PAULO
from rentalops_api.rental_models import Rental, RentalAllocation


def simultaneous_segments(
    intervals: list[tuple[date, date, int]], start: date, end: date
) -> list[tuple[date, date, int]]:
    """Closed dates; bounded sweep avoids iterating every day of long rentals."""
    events: dict[date, int] = defaultdict(int)
    events[start] = 0
    for pickup, returned, quantity in intervals:
        if pickup > end or returned < start:
            continue
        events[max(start, pickup)] += quantity
        if returned < end:
            events[returned + timedelta(days=1)] -= quantity
    dates = sorted(events)
    result = []
    committed = 0
    for index, day in enumerate(dates):
        committed += events[day]
        until = dates[index + 1] - timedelta(days=1) if index + 1 < len(dates) else end
        result.append((day, until, committed))
    return result


def outstanding_demand(session: Session, rental_id: UUID) -> dict[UUID, int] | None:
    """Physical custody, not the immutable commercial composition, after pickup."""
    handover = session.scalar(select(Handover).where(Handover.rental_id == rental_id))
    if handover is None:
        return None
    demand = {
        UUID(str(line["product_id"])): int(str(line["quantity"]))
        for line in handover.lines
    }
    for event in session.scalars(
        select(ReturnEvent).where(ReturnEvent.rental_id == rental_id)
    ):
        for line in event.lines:
            demand[UUID(str(line["product_id"]))] -= int(str(line["quantity"]))
    for incident, resolution in session.execute(
        select(Incident, IncidentResolution)
        .join(IncidentResolution, IncidentResolution.incident_id == Incident.id)
        .where(
            Incident.rental_id == rental_id,
            Incident.kind == "outstanding",
            IncidentResolution.disposition == "lost",
        )
    ):
        demand[incident.product_id] -= resolution.quantity
    return {pid: qty for pid, qty in demand.items() if qty}


def capacity_view(
    session: Session,
    products: dict[UUID, Product],
    demand: dict[UUID, int],
    start: date,
    end: date,
    *,
    exclude_rental: UUID | None = None,
    today: date | None = None,
) -> list[dict[str, object]]:
    today = today or datetime.now(UTC).astimezone(SAO_PAULO).date()
    physical = list(
        session.execute(
            select(Handover, Rental).join(Rental, Rental.id == Handover.rental_id)
        )
    )
    physical_ids = {rental.id for _, rental in physical}
    query = select(RentalAllocation).where(
        RentalAllocation.product_id.in_(demand),
        RentalAllocation.pickup_date <= end,
        RentalAllocation.return_date >= start,
    )
    if exclude_rental:
        query = query.where(RentalAllocation.rental_id != exclude_rental)
    intervals: dict[UUID, list[tuple[date, date, int]]] = defaultdict(list)
    for row in session.scalars(query):
        if row.rental_id in physical_ids:
            continue
        intervals[row.product_id].append(
            (row.pickup_date, row.return_date, row.quantity)
        )
    # Sourced maintenance is a dated interval, not a second global deduction
    # alongside custody. Catalog-only maintenance remains the global baseline.
    sourced_active: dict[UUID, int] = defaultdict(int)
    incidents = list(
        session.scalars(select(Incident).where(Incident.product_id.in_(demand)))
    )
    resolutions = list(
        session.scalars(
            select(IncidentResolution).where(
                IncidentResolution.incident_id.in_([row.id for row in incidents])
            )
        )
    )
    for incident in incidents:
        if incident.maintenance_id is None or incident.received_date is None:
            continue
        decided = [
            row
            for row in resolutions
            if row.incident_id == incident.id and row.disposition != "maintenance"
        ]
        remaining = incident.quantity - sum(row.quantity for row in decided)
        sourced_active[incident.product_id] += remaining
        # Maintenance remains relevant even when excluding this rental during
        # its extension preview: it is unavailable physical stock.
        if remaining:
            intervals[incident.product_id].append(
                (incident.received_date, date.max, remaining)
            )
        for resolution in decided:
            intervals[incident.product_id].append(
                (
                    incident.received_date,
                    resolution.effective_date - timedelta(days=1),
                    resolution.quantity,
                )
            )
    for handover, rental in physical:
        if rental.id == exclude_rental:
            continue
        pickup = min(
            handover.business_date,
            date.fromisoformat(str(rental.commercial_snapshot["pickup_date"])),
        )
        planned = date.fromisoformat(str(rental.commercial_snapshot["return_date"]))
        returned = list(
            session.scalars(
                select(ReturnEvent).where(ReturnEvent.rental_id == rental.id)
            )
        )
        for line in handover.lines:
            pid = UUID(str(line["product_id"]))
            if pid not in demand:
                continue
            received = 0
            for event in returned:
                for item in event.lines:
                    if str(item["product_id"]) != str(pid):
                        continue
                    qty = int(str(item["quantity"]))
                    received += qty
                    until = (
                        event.business_date
                        if item["condition"] == "fit"
                        else event.business_date - timedelta(days=1)
                    )
                    intervals[pid].append((pickup, until, qty))
            lost = sum(
                row.quantity
                for row in resolutions
                if row.rental_id == rental.id
                and row.disposition == "lost"
                and any(
                    i.id == row.incident_id
                    and i.product_id == pid
                    and i.kind == "outstanding"
                    for i in incidents
                )
            )
            outstanding = int(str(line["quantity"])) - received - lost
            if outstanding:
                intervals[pid].append(
                    (
                        pickup,
                        date.max if returned or today > planned else planned,
                        outstanding,
                    )
                )
    result: list[dict[str, object]] = []
    for pid, quantity in sorted(demand.items()):
        product = products[pid]
        apt = (
            product.total_quantity - product.maintenance_quantity + sourced_active[pid]
        )
        segments = simultaneous_segments(intervals[pid], start, end)
        committed = max(value for _, _, value in segments)
        available = max(0, apt - committed)
        result.append(
            {
                "product_id": str(pid),
                "name": product.name,
                "demand": quantity,
                "apt": apt,
                "committed": committed,
                "available": available,
                "shortage": max(0, quantity + committed - apt),
                "conflicts": [
                    {
                        "start": first.isoformat(),
                        "end": last.isoformat(),
                        "committed": count,
                        "available": max(0, apt - count),
                        "shortage": max(0, quantity + count - apt),
                    }
                    for first, last, count in segments
                    if quantity + count > apt
                ],
            }
        )
    return result
