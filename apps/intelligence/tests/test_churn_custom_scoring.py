"""The BYO-churn chain end to end: recompute prefers the workspace's
ACTIVE custom model, falls back to the built-in on any failure (marking
the row FAILED and raising one alert), and the upload/validate API stores
real artifacts and explains every rejection."""

from __future__ import annotations

import base64
import hashlib
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from helio_intelligence.app import create_app
from helio_intelligence.scoring import ScoringService
from helio_intelligence.scoring.features import FEATURE_NAMES
from helio_intelligence.vault import encrypt_field

KEY = base64.b64encode(hashlib.sha256(b"helio-churn-test-key").digest()).decode()
N_FEATURES = len(FEATURE_NAMES)


def _contact(cid: str, email: str, tenure: float = 90.0) -> dict[str, Any]:
    return {"id": cid, "email": email, "tenure_days": tenure, "rule_score": 1}


def _agg(email: str, events_30d: int) -> dict[str, Any]:
    return {
        "email": email,
        "total_events": events_30d * 2,
        "distinct_events": 2,
        "events_7d": 1,
        "events_30d": events_30d,
        "opens": 1,
        "clicks": 0,
        "pageviews": 3,
        "recency_days": 2,
    }


class _Scoped:
    def __init__(self, db: _FakeDb) -> None:
        self._db = db

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        return self._db.contacts

    async def fetchval(self, query: str, *args: Any) -> Any:
        if "provider_credential" in query:
            return self._db.credential_secrets
        if "system_alert" in query:
            return 1 if self._db.alert_exists else None
        return None  # workspace conversion-events override

    async def fetchrow(self, query: str, *args: Any) -> Any:
        return self._db.model_row

    async def execute(self, query: str, *args: Any) -> str:
        self._db.statements.append((query.strip(), args))
        return "OK"

    async def executemany(self, query: str, args: list[tuple[Any, ...]]) -> None:
        self._db.writes.extend(args)


class _FakeDb:
    def __init__(
        self,
        contacts: list[dict[str, Any]],
        model_row: dict[str, Any] | None = None,
        credential_secrets: Any = None,
    ) -> None:
        self.contacts = contacts
        self.model_row = model_row
        self.credential_secrets = credential_secrets
        self.alert_exists = False
        self.writes: list[Any] = []
        self.statements: list[tuple[str, tuple[Any, ...]]] = []

    @asynccontextmanager
    async def scoped(self, organization_id: str):  # type: ignore[no-untyped-def]
        yield _Scoped(self)


class _FakeCh:
    def __init__(self, aggregates: list[dict[str, Any]]) -> None:
        self._aggregates = aggregates

    async def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        if "toHour" in sql:
            return []
        if "GROUP BY user_id" in sql:
            return self._aggregates
        return []


def _workspace(n: int = 5) -> tuple[_FakeDb, _FakeCh]:
    contacts = [_contact(f"c{i}", f"u{i}@x.com") for i in range(n)]
    aggregates = [_agg(f"u{i}@x.com", events_30d=(0 if i % 2 else 4)) for i in range(n)]
    return _FakeDb(contacts), _FakeCh(aggregates)


def _model_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": "chm_1",
        "name": "my model",
        "format": "XGBOOST_JSON",
        "credential_id": None,
        "endpoint_url": None,
        "feature_mapping": json.dumps({"inputs": list(FEATURE_NAMES)}),
    }
    row.update(overrides)
    return row


@pytest.fixture(scope="module")
def xgboost_bytes() -> bytes:
    import numpy as np
    import xgboost as xgb

    rng = np.random.default_rng(7)
    features = rng.random((80, N_FEATURES)).astype(np.float32) * 10
    labels = (features[:, 0] + features[:, 8] > 10).astype(int)
    booster = xgb.train(
        {"objective": "binary:logistic", "max_depth": 2, "seed": 7},
        xgb.DMatrix(features, label=labels),
        num_boost_round=4,
    )
    raw = booster.save_raw("json")
    return bytes(raw)


# --- recompute chain ----------------------------------------------------------


async def test_recompute_uses_the_active_artifact_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, xgboost_bytes: bytes
) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    from helio_intelligence.model_runtime.storage import store_artifact

    store_artifact("org_a", "chm_1", ".json", xgboost_bytes)
    db, ch = _workspace()
    db.model_row = _model_row()
    service = ScoringService(db, ch, conversion_events=[])  # type: ignore[arg-type]

    result = await service.recompute("org_a", "ws_a")

    assert result.churn_method == "custom"
    assert len(db.writes) == 5
    assert all(0.0 <= write[2] <= 1.0 for write in db.writes)
    assert db.writes[0][3].endswith("churn:custom")
    assert not db.statements  # nothing failed, nothing recorded


async def test_recompute_falls_back_and_records_when_the_file_is_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    db, ch = _workspace()
    db.model_row = _model_row(id="chm_gone")
    service = ScoringService(db, ch, conversion_events=[])  # type: ignore[arg-type]

    result = await service.recompute("org_a", "ws_a")

    # Scoring still landed, on the built-in model.
    assert result.churn_method == "custom_failed_fallback"
    assert len(db.writes) == 5
    # The row went FAILED with a readable reason, and one alert was raised.
    failed = [s for s in db.statements if "UPDATE churn_model" in s[0]]
    assert failed and failed[0][1][0] == "chm_gone"
    assert "upload it again" in failed[0][1][1]
    alerts = [s for s in db.statements if "INSERT INTO system_alert" in s[0]]
    assert len(alerts) == 1
    assert alerts[0][1][2] == "churn_model_failed"
    assert json.loads(alerts[0][1][4])["modelId"] == "chm_gone"


async def test_recompute_does_not_duplicate_unread_alerts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    db, ch = _workspace()
    db.model_row = _model_row(id="chm_gone")
    db.alert_exists = True
    service = ScoringService(db, ch, conversion_events=[])  # type: ignore[arg-type]

    await service.recompute("org_a", "ws_a")

    assert not [s for s in db.statements if "INSERT INTO system_alert" in s[0]]


async def test_recompute_calls_an_http_model_with_the_mapped_columns() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        seen["feature_names"] = body["feature_names"]
        seen["width"] = len(body["inputs"][0])
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"predictions": [0.42] * len(body["inputs"])})

    envelope = encrypt_field(
        "Bearer model-secret",
        organization_id="org_a",
        credential_id="cred_9",
        field="authHeader",
        key_b64=KEY,
    )
    db, ch = _workspace()
    db.model_row = _model_row(
        format="HTTP",
        endpoint_url="https://models.example.com/churn",
        credential_id="cred_9",
        feature_mapping=json.dumps({"inputs": ["opens", "clicks", "tenure_days"]}),
    )
    db.credential_secrets = {"authHeader": envelope}
    service = ScoringService(
        db,  # type: ignore[arg-type]
        ch,  # type: ignore[arg-type]
        conversion_events=[],
        encryption_key=KEY,
        endpoint_transport=httpx.MockTransport(handler),
    )

    result = await service.recompute("org_a", "ws_a")

    assert result.churn_method == "custom"
    assert seen["feature_names"] == ["opens", "clicks", "tenure_days"]
    assert seen["width"] == 3
    assert seen["auth"] == "Bearer model-secret"
    assert all(write[2] == 0.42 for write in db.writes)


async def test_http_model_failure_falls_back_with_the_endpoint_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    db, ch = _workspace()
    db.model_row = _model_row(format="HTTP", endpoint_url="https://models.example.com/churn")
    service = ScoringService(
        db,  # type: ignore[arg-type]
        ch,  # type: ignore[arg-type]
        conversion_events=[],
        endpoint_transport=httpx.MockTransport(handler),
    )

    result = await service.recompute("org_a", "ws_a")

    assert result.churn_method == "custom_failed_fallback"
    failed = [s for s in db.statements if "UPDATE churn_model" in s[0]]
    assert "HTTP 500" in failed[0][1][1]


async def test_empty_feature_mapping_fails_readably() -> None:
    db, ch = _workspace()
    db.model_row = _model_row(feature_mapping=json.dumps({"inputs": ["nope"]}))
    service = ScoringService(db, ch, conversion_events=[])  # type: ignore[arg-type]

    result = await service.recompute("org_a", "ws_a")

    assert result.churn_method == "custom_failed_fallback"
    failed = [s for s in db.statements if "UPDATE churn_model" in s[0]]
    assert "feature mapping" in failed[0][1][1]


# --- training-data export -----------------------------------------------------


async def test_export_features_writes_the_contract_columns() -> None:
    db, ch = _workspace(4)
    service = ScoringService(db, ch, conversion_events=[])  # type: ignore[arg-type]

    csv_text = await service.export_features("org_a", "ws_a")
    lines = csv_text.strip().splitlines()
    assert lines[0] == ",".join([*FEATURE_NAMES, "churned_label"])
    assert len(lines) == 5  # header + 4 eligible contacts
    assert "@x.com" not in csv_text  # emails only on explicit opt-in

    with_email = await service.export_features("org_a", "ws_a", include_email=True)
    assert with_email.splitlines()[0].startswith("email,")
    assert "u0@x.com" in with_email


async def test_export_features_skips_contacts_too_young_to_label() -> None:
    db = _FakeDb([_contact("c1", "young@x.com", tenure=3.0)])
    service = ScoringService(db, _FakeCh([]), conversion_events=[])  # type: ignore[arg-type]
    csv_text = await service.export_features("org_a", "ws_a")
    assert len(csv_text.strip().splitlines()) == 1  # header only


# --- upload / validate API ----------------------------------------------------


def _upload(client: TestClient, content: bytes, **form: Any) -> httpx.Response:
    fields = {
        "organization_id": "org_a",
        "model_id": "chm_1",
        "format": "XGBOOST_JSON",
        "n_inputs": str(N_FEATURES),
    }
    fields.update({k: str(v) for k, v in form.items()})
    return client.post(
        "/v1/models/churn/upload",
        data=fields,
        files={"file": ("churn.json", content, "application/octet-stream")},
    )


def test_upload_stores_validates_and_reports(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, xgboost_bytes: bytes
) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    client = TestClient(create_app())

    response = _upload(client, xgboost_bytes)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True and body["error"] is None
    assert body["sha256"] == hashlib.sha256(xgboost_bytes).hexdigest()
    assert (tmp_path / "org_a" / "chm_1.json").exists()

    # A JSON file that isn't a model is a verdict, not a transport error.
    # (XGBoost itself tolerates a too-small n_inputs — absent columns are
    # "missing" — so the strict-shape case lives in the ONNX runtime tests.)
    verdict = _upload(client, b'{"not": "an xgboost model"}', model_id="chm_2").json()
    assert verdict["ok"] is False
    assert verdict["error"]


def test_upload_refuses_pickle_with_the_conversion_recipe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    client = TestClient(create_app())
    response = _upload(client, b"\x80\x04 not a model", format="ONNX")
    assert response.status_code == 422
    assert "skl2onnx" in response.json()["detail"]
    assert not list(tmp_path.glob("**/*"))  # nothing was stored


def test_upload_rejects_unknown_formats(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    client = TestClient(create_app())
    assert _upload(client, b"{}", format="PICKLE").status_code == 422


def test_validate_endpoint_returns_guard_verdicts() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/v1/models/churn/validate-endpoint",
        json={
            "organization_id": "org_a",
            "url": "http://models.internal/churn",
            "inputs": ["opens", "clicks"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "https" in body["error"]

    unknown = client.post(
        "/v1/models/churn/validate-endpoint",
        json={"organization_id": "org_a", "url": "https://x.example", "inputs": ["wat"]},
    )
    assert unknown.status_code == 422


def test_delete_artifact_removes_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, xgboost_bytes: bytes
) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    from helio_intelligence.model_runtime.storage import store_artifact

    store_artifact("org_a", "chm_9", ".json", xgboost_bytes)
    client = TestClient(create_app())
    response = client.post(
        "/v1/models/churn/delete-artifact",
        json={"organization_id": "org_a", "model_id": "chm_9"},
    )
    assert response.status_code == 200
    assert not (tmp_path / "org_a" / "chm_9.json").exists()
