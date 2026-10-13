from datetime import date

import pytest
from pydantic import ValidationError

from rentalops_api.dashboard_contracts import CalendarQuery, DayQuery, UpcomingQuery


@pytest.mark.parametrize(
    "fields",
    [
        {"page": "1.0"},
        {"page": True},
        {"page_size": "101"},
        {"page": "0"},
        {"date": "2026-2-01"},
        {"date": "2026-02-30"},
        {"customer_id": "name"},
        {"financial_pending": "1"},
        {"financial_pending": 1},
        {"operational_state": "paid"},
        {"actor_id": "x"},
    ],
)
def test_strict_dashboard_queries(fields):
    with pytest.raises(ValidationError):
        DayQuery.model_validate(fields)


def test_explicit_horizon_and_defaults():
    today = date(2026, 12, 31)
    assert UpcomingQuery().period(today) == (today, date(2027, 1, 29))
    value = UpcomingQuery.model_validate({"from": "2026-12-01", "to": "2027-02-28"})
    assert (value.period(today)[1] - value.period(today)[0]).days == 89
    for fields in (
        {"from": "2026-01-01", "to": "2026-04-01"},
        {"from": "2026-01-02", "to": "2026-01-01"},
    ):
        with pytest.raises(ValidationError):
            UpcomingQuery.model_validate(fields)
    assert (
        DayQuery.model_validate({"page": "2", "financial_pending": "false"}).page == 2
    )
    assert CalendarQuery(month="2024-02").month == "2024-02"
    for month in ("2026-13", "0000-01", "2026-1", "202601"):
        with pytest.raises(ValidationError):
            CalendarQuery(month=month)
