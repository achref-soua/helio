"""Recompute predictive scores for one workspace, end to end.

Pulls contacts (Postgres) and behavioral aggregates (ClickHouse), trains a
conversion-propensity model and a churn-risk model, predicts for every
contact, and writes the probabilities back to Postgres — all inside an
RLS-scoped transaction so a run can only ever touch its own organization.
"""

from __future__ import annotations

from dataclasses import dataclass

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
    prediction_computed_at = now()
WHERE id = $1 AND workspace_id = $5
"""


@dataclass(frozen=True)
class ScoringResult:
    scored: int
    conversion_method: str
    churn_method: str
    converted: int
    churned: int


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
        if not contacts:
            return ScoringResult(0, "none", "none", 0, 0)

        aggregates = await self._ch.query(_AGGREGATE_SQL, {"workspace_id": workspace_id})
        converted_emails = await self._converted_emails(workspace_id)
        frame = build_feature_frame(contacts, aggregates, converted_emails)

        conversion = train(frame.columns(CONVERSION_FEATURES), frame.converted)
        conversion_prob = conversion.predict(frame.columns(CONVERSION_FEATURES))

        churn_method, churn_risk = self._fit_churn(frame)

        model_tag = f"conv:{conversion.method};churn:{churn_method}"
        updates = [
            (
                frame.contact_ids[i],
                round(float(conversion_prob[i]), 4),
                round(float(churn_risk[i]), 4),
                model_tag,
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

    async def _converted_emails(self, workspace_id: str) -> set[str]:
        if not self._conversion_events:
            return set()
        names = ", ".join(f"'{name}'" for name in self._conversion_events)
        sql = (
            "SELECT DISTINCT user_id AS email FROM events "
            "WHERE workspace_id = {workspace_id:String} "
            f"AND user_id != '' AND event IN ({names})"
        )
        rows = await self._ch.query(sql, {"workspace_id": workspace_id})
        return {row["email"] for row in rows}
