"""Recompute predictive scores for one workspace, end to end.

Pulls contacts (Postgres) and behavioral aggregates (ClickHouse), trains a
conversion-propensity model and a churn-risk model, predicts for every
contact, and writes the probabilities back to Postgres — all inside an
RLS-scoped transaction so a run can only ever touch its own organization.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..data.db import Database
from .clickhouse import ClickHouseClient
from .features import (
    CHURN_FEATURES,
    CONVERSION_FEATURES,
    FeatureFrame,
    build_feature_frame,
    safe_event_names,
)
from .model import train
from .send_time import DEFAULT_HOUR, best_hours

_AGGREGATE_SQL = """
SELECT
  user_id AS email,
  count() AS total_events,
  uniqExact(event) AS distinct_events,
  countIf(timestamp > now() - INTERVAL 7 DAY) AS events_7d,
  countIf(timestamp > now() - INTERVAL 30 DAY) AS events_30d,
  countIf(event = 'Email Opened') AS opens,
  countIf(event = 'Email Clicked') AS clicks,
  countIf(type = 'page') AS pageviews,
  dateDiff('day', max(timestamp), now()) AS recency_days
FROM events
WHERE workspace_id = {workspace_id:String} AND user_id != ''
GROUP BY user_id
"""

_CONTACTS_SQL = """
SELECT id, email,
       EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS tenure_days,
       score AS rule_score
FROM contact
WHERE workspace_id = $1
"""

_PERSIST_SQL = """
UPDATE contact
SET conversion_probability = $2,
    churn_risk = $3,
    prediction_model = $4,
    best_send_hour = $5,
    prediction_computed_at = now()
WHERE id = $1 AND workspace_id = $6
"""

_SEND_HOUR_SQL = """
SELECT user_id AS email, toHour(timestamp) AS hour, count() AS count
FROM events
WHERE workspace_id = {workspace_id:String} AND user_id != ''
  AND event IN ('Email Opened', 'Email Clicked')
GROUP BY user_id, hour
"""


@dataclass(frozen=True)
class ScoringResult:
    scored: int
    conversion_method: str
    churn_method: str
    converted: int
    churned: int
    send_hour_fallback: int


class ScoringService:
    def __init__(
        self,
        database: Database,
        clickhouse: ClickHouseClient,
        *,
        conversion_events: list[str],
    ) -> None:
        self._db = database
        self._ch = clickhouse
        self._conversion_events = safe_event_names(conversion_events)

    async def recompute(self, organization_id: str, workspace_id: str) -> ScoringResult:
        async with self._db.scoped(organization_id) as scoped:
            contact_rows = await scoped.fetch(_CONTACTS_SQL, workspace_id)
            contacts = [dict(row) for row in contact_rows]
            conversion_events = await self._workspace_conversion_events(scoped, workspace_id)
        if not contacts:
            return ScoringResult(0, "none", "none", 0, 0, DEFAULT_HOUR)

        aggregates = await self._ch.query(_AGGREGATE_SQL, {"workspace_id": workspace_id})
        converted_emails = await self._converted_emails(workspace_id, conversion_events)
        frame = build_feature_frame(contacts, aggregates, converted_emails)

        conversion = train(frame.columns(CONVERSION_FEATURES), frame.converted)
        conversion_prob = conversion.predict(frame.columns(CONVERSION_FEATURES))

        churn_method, churn_risk = self._fit_churn(frame)

        hour_rows = await self._ch.query(_SEND_HOUR_SQL, {"workspace_id": workspace_id})
        per_email_hour, fallback_hour = best_hours(hour_rows)

        model_tag = f"conv:{conversion.method};churn:{churn_method}"
        updates = [
            (
                frame.contact_ids[i],
                round(float(conversion_prob[i]), 4),
                round(float(churn_risk[i]), 4),
                model_tag,
                per_email_hour.get(frame.emails[i], fallback_hour),
                workspace_id,
            )
            for i in range(frame.size)
        ]
        async with self._db.scoped(organization_id) as scoped:
            await scoped.executemany(_PERSIST_SQL, updates)

        return ScoringResult(
            scored=frame.size,
            conversion_method=conversion.method,
            churn_method=churn_method,
            converted=int(frame.converted.sum()),
            churned=int(frame.churned.sum()),
            send_hour_fallback=fallback_hour,
        )

    def _fit_churn(self, frame: FeatureFrame) -> tuple[str, NDArray[np.float64]]:
        # Train only on contacts old enough to have a meaningful churn
        # label; predict for everyone.
        churn_features = frame.columns(CHURN_FEATURES)
        eligible = frame.eligible_for_churn
        if bool(eligible.any()):
            model = train(churn_features[eligible], frame.churned[eligible])
            return model.method, model.predict(churn_features)
        # No contact is old enough yet — nothing to learn from.
        return "insufficient_data", np.zeros(frame.size, dtype=np.float64)

    async def _workspace_conversion_events(
        self,
        scoped: Any,
        workspace_id: str,
    ) -> list[str]:
        """The workspace's own conversion-event list, or the deployment
        default. Stored as JSON on the workspace row; anything unparseable
        falls back rather than failing a recompute."""
        try:
            raw = await scoped.fetchval(
                "SELECT conversion_events FROM workspace WHERE id = $1", workspace_id
            )
        except Exception:  # noqa: BLE001 — pre-migration databases lack the column
            return self._conversion_events
        if raw is None:
            return self._conversion_events
        value = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(value, list):
            return self._conversion_events
        names = safe_event_names([str(item) for item in value])
        return names if names else self._conversion_events

    async def _converted_emails(self, workspace_id: str, events: list[str]) -> set[str]:
        if not events:
            return set()
        names = ", ".join(f"'{name}'" for name in events)
        sql = (
            "SELECT DISTINCT user_id AS email FROM events "
            "WHERE workspace_id = {workspace_id:String} "
            f"AND user_id != '' AND event IN ({names})"
        )
        rows = await self._ch.query(sql, {"workspace_id": workspace_id})
        return {row["email"] for row in rows}
