"""Per-contact behavioral features for predictive scoring.

Features come from two places: behavioral aggregates from the ClickHouse
event store (keyed by ``user_id`` = the contact's email) and tenure/score
from Postgres. Everything is assembled into a dense, ordered matrix the
models consume — see ``model.py``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

# Ordered feature columns. The two models select subsets by name (see
# CONVERSION_FEATURES / CHURN_FEATURES) so this stays the single source.
FEATURE_NAMES: tuple[str, ...] = (
    "total_events",
    "distinct_events",
    "events_7d",
    "events_30d",
    "opens",
    "clicks",
    "pageviews",
    "recency_days",
    "tenure_days",
    "rule_score",
)

# Conversion propensity uses the full behavioral picture.
CONVERSION_FEATURES: tuple[str, ...] = FEATURE_NAMES
# Churn risk deliberately drops the recency/short-window counts that
# *define* the churn label, to avoid target leakage — it predicts churn
# from a contact's lifetime engagement shape and tenure.
CHURN_FEATURES: tuple[str, ...] = (
    "total_events",
    "distinct_events",
    "opens",
    "clicks",
    "pageviews",
    "tenure_days",
    "rule_score",
)

# A contact with no event in this many days is treated as churned (label).
CHURN_INACTIVITY_DAYS = 30
# Recency sentinel for contacts ClickHouse has never seen an event for.
_NO_ACTIVITY_RECENCY = 3650

_SAFE_EVENT_NAME = re.compile(r"^[A-Za-z0-9 _\-]{1,80}$")


def safe_event_names(names: list[str]) -> list[str]:
    """Keep only simple names — these are interpolated as SQL literals, so
    anything with quotes or odd characters is rejected outright."""
    return [name for name in names if _SAFE_EVENT_NAME.match(name)]


@dataclass
class FeatureFrame:
    contact_ids: list[str]
    emails: list[str]
    matrix: NDArray[np.float64]  # shape (n_contacts, len(FEATURE_NAMES))
    converted: NDArray[np.bool_]  # conversion label
    eligible_for_churn: NDArray[np.bool_]  # tenure >= CHURN_INACTIVITY_DAYS
    churned: NDArray[np.bool_]  # churn label (no events in window)
    _index: dict[str, int] = field(default_factory=dict)

    def columns(self, names: tuple[str, ...]) -> NDArray[np.float64]:
        idx = [FEATURE_NAMES.index(name) for name in names]
        return self.matrix[:, idx]

    @property
    def size(self) -> int:
        return len(self.contact_ids)


def build_feature_frame(
    contacts: list[dict[str, Any]],
    aggregates: list[dict[str, Any]],
    converted_emails: set[str],
) -> FeatureFrame:
    """Join Postgres contacts with ClickHouse aggregates into a matrix.

    ``contacts`` rows: id, email, tenure_days, rule_score.
    ``aggregates`` rows: the ClickHouse per-email counts (see service.py).
    """
    by_email = {row["email"]: row for row in aggregates}
    ids: list[str] = []
    emails: list[str] = []
    rows: list[list[float]] = []
    converted: list[bool] = []
    eligible: list[bool] = []
    churned: list[bool] = []

    for contact in contacts:
        email = contact["email"]
        agg = by_email.get(email, {})
        events_30d = _num(agg.get("events_30d"))
        recency = _num(agg.get("recency_days"), default=_NO_ACTIVITY_RECENCY)
        tenure = _num(contact.get("tenure_days"))
        rows.append(
            [
                _num(agg.get("total_events")),
                _num(agg.get("distinct_events")),
                _num(agg.get("events_7d")),
                events_30d,
                _num(agg.get("opens")),
                _num(agg.get("clicks")),
                _num(agg.get("pageviews")),
                recency,
                tenure,
                _num(contact.get("rule_score")),
            ]
        )
        ids.append(contact["id"])
        emails.append(email)
        converted.append(email in converted_emails)
        is_eligible = tenure >= CHURN_INACTIVITY_DAYS
        eligible.append(is_eligible)
        churned.append(is_eligible and events_30d == 0)

    matrix = np.array(rows, dtype=np.float64).reshape(len(rows), len(FEATURE_NAMES))
    return FeatureFrame(
        contact_ids=ids,
        emails=emails,
        matrix=matrix,
        converted=np.array(converted, dtype=np.bool_),
        eligible_for_churn=np.array(eligible, dtype=np.bool_),
        churned=np.array(churned, dtype=np.bool_),
        _index={email: i for i, email in enumerate(emails)},
    )


def _num(value: Any, *, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
