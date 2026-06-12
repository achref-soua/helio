"""Recompute predictive scores for one workspace, end to end.

Pulls contacts (Postgres) and behavioral aggregates (ClickHouse), trains a
conversion-propensity model and a churn-risk model, predicts for every
contact, and writes the probabilities back to Postgres — all inside an
RLS-scoped transaction so a run can only ever touch its own organization.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import numpy as np
from numpy.typing import NDArray

from ..data.db import Database
from ..model_runtime import predict_via_endpoint, predict_with_artifact
from ..model_runtime.storage import artifact_path
from ..model_runtime.validator import check_probabilities
from ..vault import decrypt_field
from .clickhouse import ClickHouseClient
from .features import (
    CHURN_FEATURES,
    CONVERSION_FEATURES,
    FEATURE_NAMES,
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

_ACTIVE_MODEL_SQL = """
SELECT id, name, format, credential_id, endpoint_url, feature_mapping
FROM churn_model
WHERE workspace_id = $1 AND status = 'ACTIVE'
ORDER BY updated_at DESC
LIMIT 1
"""

_MODEL_FAILED_SQL = """
UPDATE churn_model
SET status = 'FAILED', last_error = $2, updated_at = now()
WHERE id = $1
"""

_ALERT_EXISTS_SQL = """
SELECT 1 FROM system_alert
WHERE organization_id = $1 AND kind = $2 AND read_at IS NULL
  AND context->>'modelId' = $3
LIMIT 1
"""

_ALERT_INSERT_SQL = """
INSERT INTO system_alert (id, organization_id, kind, message, context)
VALUES ($1, $2, $3, $4, $5::jsonb)
"""

_CREDENTIAL_SECRET_SQL = """
SELECT secrets FROM provider_credential
WHERE id = $1 AND kind = 'CHURN_ENDPOINT'
"""


class CustomModelError(Exception):
    """A bring-your-own churn model could not produce usable predictions."""


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
        encryption_key: str = "",
        encryption_key_previous: str | None = None,
        allow_private_endpoints: bool = False,
        endpoint_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._db = database
        self._ch = clickhouse
        self._conversion_events = safe_event_names(conversion_events)
        self._encryption_key = encryption_key
        self._encryption_key_previous = encryption_key_previous
        self._allow_private_endpoints = allow_private_endpoints
        # Tests inject an httpx.MockTransport; production leaves this None.
        self._endpoint_transport = endpoint_transport

    async def recompute(self, organization_id: str, workspace_id: str) -> ScoringResult:
        async with self._db.scoped(organization_id) as scoped:
            contact_rows = await scoped.fetch(_CONTACTS_SQL, workspace_id)
            contacts = [dict(row) for row in contact_rows]
            conversion_events = await self._workspace_conversion_events(scoped, workspace_id)
            model_record = await scoped.fetchrow(_ACTIVE_MODEL_SQL, workspace_id)
            custom_model = dict(model_record) if model_record is not None else None
        if not contacts:
            return ScoringResult(0, "none", "none", 0, 0, DEFAULT_HOUR)

        aggregates = await self._ch.query(_AGGREGATE_SQL, {"workspace_id": workspace_id})
        converted_emails = await self._converted_emails(workspace_id, conversion_events)
        frame = build_feature_frame(contacts, aggregates, converted_emails)

        conversion = train(frame.columns(CONVERSION_FEATURES), frame.converted)
        conversion_prob = conversion.predict(frame.columns(CONVERSION_FEATURES))

        churn_method, churn_risk = await self._churn(organization_id, frame, custom_model)

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

    async def _churn(
        self,
        organization_id: str,
        frame: FeatureFrame,
        custom_model: dict[str, Any] | None,
    ) -> tuple[str, NDArray[np.float64]]:
        """The fallback chain (ADR-0021): the workspace's ACTIVE custom model
        first; on any failure mark it FAILED, raise a system alert, and score
        with the built-in model so the recompute still lands."""
        if custom_model is None:
            return self._fit_churn(frame)
        try:
            risk = await self._predict_custom(organization_id, custom_model, frame)
        except Exception as error:  # noqa: BLE001 — any model failure falls back
            await self._record_model_failure(organization_id, custom_model, str(error))
            _, risk = self._fit_churn(frame)
            return "custom_failed_fallback", risk
        return "custom", risk

    async def _predict_custom(
        self,
        organization_id: str,
        model: dict[str, Any],
        frame: FeatureFrame,
    ) -> NDArray[np.float64]:
        mapping = _as_mapping(model.get("feature_mapping"))
        inputs = [str(name) for name in mapping.get("inputs", []) if str(name) in FEATURE_NAMES]
        if not inputs:
            raise CustomModelError(
                "the feature mapping has no usable inputs — edit it in the churn-model panel"
            )
        matrix: list[list[float]] = frame.columns(tuple(inputs)).tolist()
        model_format = str(model.get("format", ""))

        if model_format == "HTTP":
            url = str(model.get("endpoint_url") or "")
            if not url:
                raise CustomModelError("the model has no endpoint URL — register it again")
            predictions = await predict_via_endpoint(
                url,
                inputs,
                matrix,
                auth_header=await self._endpoint_auth_header(organization_id, model),
                allow_private=self._allow_private_endpoints,
                transport=self._endpoint_transport,
            )
        else:
            extension = ".onnx" if model_format == "ONNX" else ".json"
            path = artifact_path(organization_id, str(model["id"]), extension)
            if not path.exists():
                raise CustomModelError("the model file is missing — upload it again")
            predictions = await asyncio.to_thread(
                predict_with_artifact, model_format, str(path), matrix
            )

        problem = check_probabilities(predictions, frame.size)
        if problem is not None:
            raise CustomModelError(problem)
        return np.clip(np.asarray(predictions, dtype=np.float64), 0.0, 1.0)

    async def _endpoint_auth_header(
        self, organization_id: str, model: dict[str, Any]
    ) -> str | None:
        credential_id = model.get("credential_id")
        if not credential_id or not self._encryption_key:
            return None
        async with self._db.scoped(organization_id) as scoped:
            secrets = await scoped.fetchval(_CREDENTIAL_SECRET_SQL, str(credential_id))
        envelope = _as_mapping(secrets).get("authHeader")
        if not isinstance(envelope, str) or not envelope:
            return None
        return decrypt_field(
            envelope,
            organization_id=organization_id,
            credential_id=str(credential_id),
            field="authHeader",
            key_b64=self._encryption_key,
            previous_key_b64=self._encryption_key_previous,
        )

    async def _record_model_failure(
        self, organization_id: str, model: dict[str, Any], error: str
    ) -> None:
        """Best-effort bookkeeping: the model row goes FAILED (so the panel
        shows why and the next recompute skips straight to the built-in) and
        an unread system alert is raised once per model."""
        detail = error.strip()[:500] or "the model failed without a message"
        model_id = str(model["id"])
        try:
            async with self._db.scoped(organization_id) as scoped:
                await scoped.execute(_MODEL_FAILED_SQL, model_id, detail)
                already = await scoped.fetchval(
                    _ALERT_EXISTS_SQL, organization_id, "churn_model_failed", model_id
                )
                if not already:
                    await scoped.execute(
                        _ALERT_INSERT_SQL,
                        f"alrt_{uuid.uuid4().hex}",
                        organization_id,
                        "churn_model_failed",
                        (
                            f"churn model “{model.get('name', model_id)}” failed and "
                            "scoring fell back to the built-in model"
                        ),
                        json.dumps({"modelId": model_id, "error": detail}),
                    )
        except Exception:  # noqa: BLE001 — alerting must never break a recompute
            return

    async def export_features(
        self, organization_id: str, workspace_id: str, *, include_email: bool = False
    ) -> str:
        """Training data for offline model building: the exact feature
        columns the runtime will feed a custom model, plus the churn label —
        only contacts old enough for the label to mean something."""
        async with self._db.scoped(organization_id) as scoped:
            contact_rows = await scoped.fetch(_CONTACTS_SQL, workspace_id)
            contacts = [dict(row) for row in contact_rows]
            conversion_events = await self._workspace_conversion_events(scoped, workspace_id)

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        header = (["email"] if include_email else []) + [*FEATURE_NAMES, "churned_label"]
        writer.writerow(header)
        if not contacts:
            return buffer.getvalue()

        aggregates = await self._ch.query(_AGGREGATE_SQL, {"workspace_id": workspace_id})
        converted_emails = await self._converted_emails(workspace_id, conversion_events)
        frame = build_feature_frame(contacts, aggregates, converted_emails)
        for i in range(frame.size):
            if not bool(frame.eligible_for_churn[i]):
                continue
            row: list[Any] = [frame.emails[i]] if include_email else []
            row.extend(float(value) for value in frame.matrix[i])
            row.append(int(frame.churned[i]))
            writer.writerow(row)
        return buffer.getvalue()

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


def _as_mapping(value: Any) -> dict[str, Any]:
    """asyncpg hands json/jsonb columns back as strings; fakes hand dicts."""
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value if isinstance(value, dict) else {}
