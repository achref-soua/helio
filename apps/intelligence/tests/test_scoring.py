import json
from contextlib import asynccontextmanager
from typing import Any

import httpx
import numpy as np
from fastapi.testclient import TestClient

from helio_intelligence.app import create_app
from helio_intelligence.scoring import ScoringService
from helio_intelligence.scoring.clickhouse import ClickHouseClient
from helio_intelligence.scoring.features import (
    CHURN_FEATURES,
    CONVERSION_FEATURES,
    FEATURE_NAMES,
    build_feature_frame,
    safe_event_names,
)
from helio_intelligence.scoring.model import train
from helio_intelligence.scoring_api import get_scoring_service


def _contact(cid: str, email: str, tenure: float, score: int = 0) -> dict[str, Any]:
    return {"id": cid, "email": email, "tenure_days": tenure, "rule_score": score}


def _agg(email: str, **kw: Any) -> dict[str, Any]:
    base = {
        "email": email,
        "total_events": 0,
        "distinct_events": 0,
        "events_7d": 0,
        "events_30d": 0,
        "opens": 0,
        "clicks": 0,
        "pageviews": 0,
        "recency_days": 0,
    }
    base.update(kw)
    return base


def test_safe_event_names_rejects_injection() -> None:
    assert safe_event_names(["Order Completed", "Purchase"]) == ["Order Completed", "Purchase"]
    assert safe_event_names(["bad'; DROP TABLE events; --", "ok_name"]) == ["ok_name"]


def test_feature_frame_joins_and_labels() -> None:
    contacts = [
        _contact("c1", "a@x.com", tenure=90, score=10),
        _contact("c2", "b@x.com", tenure=5),  # too young for churn
        _contact("c3", "c@x.com", tenure=60),  # eligible, inactive -> churned
    ]
    aggregates = [
        _agg("a@x.com", total_events=20, events_30d=8, recency_days=2, opens=5),
        _agg("b@x.com", total_events=3, events_30d=3, recency_days=1),
    ]
    frame = build_feature_frame(contacts, aggregates, converted_emails={"a@x.com"})

    assert frame.size == 3
    assert frame.matrix.shape == (3, len(FEATURE_NAMES))
    # a@x.com converted; others not.
    assert frame.converted.tolist() == [True, False, False]
    # c1 (tenure 90) and c3 (tenure 60) are eligible; c2 (5) is not.
    assert frame.eligible_for_churn.tolist() == [True, False, True]
    # c3 has no aggregate row -> events_30d 0 and eligible -> churned.
    assert frame.churned.tolist() == [False, False, True]
    # The missing-aggregate contact gets the recency sentinel.
    recency_col = FEATURE_NAMES.index("recency_days")
    assert frame.matrix[2, recency_col] >= 3650


def test_churn_features_exclude_leaky_columns() -> None:
    assert "events_30d" not in CHURN_FEATURES
    assert "recency_days" not in CHURN_FEATURES
    assert "events_30d" in CONVERSION_FEATURES


def test_train_falls_back_to_heuristic_on_thin_data() -> None:
    features = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
    labels = np.array([False, False, True])
    model = train(features, labels)
    assert model.method == "heuristic"
    scores = model.predict(features)
    assert scores.shape == (3,)
    assert float(scores.min()) >= 0.0 and float(scores.max()) <= 1.0


def test_train_fits_gradient_boosting_on_separable_data() -> None:
    rng = np.random.default_rng(0)
    # 100 rows, a clear signal in column 0.
    positives = rng.normal(5.0, 0.5, size=(50, 3))
    negatives = rng.normal(0.0, 0.5, size=(50, 3))
    features = np.vstack([positives, negatives])
    labels = np.array([True] * 50 + [False] * 50)
    model = train(features, labels)
    assert model.method == "gradient_boosting"
    # The model should rank a clearly-positive row above a clearly-negative one.
    hi = model.predict(np.array([[5.0, 5.0, 5.0]]))[0]
    lo = model.predict(np.array([[0.0, 0.0, 0.0]]))[0]
    assert hi > lo


def test_predict_on_empty_is_empty() -> None:
    model = train(np.zeros((0, 3)), np.zeros(0, dtype=bool))
    assert model.predict(np.zeros((0, 3))).shape == (0,)


# --- Service: fakes for Postgres and ClickHouse ------------------------------


class _FakeScoped:
    def __init__(self, contacts: list[dict[str, Any]], sink: list[Any]) -> None:
        self._contacts = contacts
        self._sink = sink

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        return self._contacts

    async def executemany(self, query: str, args: list[tuple[Any, ...]]) -> None:
        self._sink.extend(args)


class _FakeDb:
    def __init__(self, contacts: list[dict[str, Any]]) -> None:
        self._contacts = contacts
        self.writes: list[Any] = []
        self.scoped_orgs: list[str] = []

    @asynccontextmanager
    async def scoped(self, organization_id: str):  # type: ignore[no-untyped-def]
        self.scoped_orgs.append(organization_id)
        yield _FakeScoped(self._contacts, self.writes)


class _FakeCh:
    def __init__(self, aggregates: list[dict[str, Any]], converted: list[str]) -> None:
        self._aggregates = aggregates
        self._converted = converted

    async def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        if "GROUP BY user_id" in sql:
            return self._aggregates
        return [{"email": e} for e in self._converted]


async def test_service_recompute_writes_scoped_predictions() -> None:
    contacts = [_contact(f"c{i}", f"u{i}@x.com", tenure=90, score=i) for i in range(6)]
    aggregates = [
        _agg(f"u{i}@x.com", total_events=i * 2, events_30d=(0 if i < 3 else 5), recency_days=i)
        for i in range(6)
    ]
    db = _FakeDb(contacts)
    ch = _FakeCh(aggregates, converted=["u5@x.com"])
    service = ScoringService(db, ch, conversion_events=["Order Completed"])  # type: ignore[arg-type]

    result = await service.recompute("org_a", "ws_a")

    assert result.scored == 6
    assert db.writes  # predictions persisted
    assert all(org == "org_a" for org in db.scoped_orgs)  # RLS-scoped to the org
    # Each write tuple is (id, conversion_prob, churn_risk, model_tag, workspace_id).
    first = db.writes[0]
    assert first[4] == "ws_a"
    assert 0.0 <= first[1] <= 1.0 and 0.0 <= first[2] <= 1.0
    assert first[3].startswith("conv:")


async def test_service_handles_empty_workspace() -> None:
    db = _FakeDb([])
    ch = _FakeCh([], converted=[])
    service = ScoringService(db, ch, conversion_events=[])  # type: ignore[arg-type]
    result = await service.recompute("org_a", "ws_a")
    assert result.scored == 0
    assert not db.writes


# --- API ---------------------------------------------------------------------


def test_scoring_endpoint_503_until_configured() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/v1/scoring/recompute", json={"organization_id": "o", "workspace_id": "w"}
    )
    assert response.status_code == 503


def test_scoring_endpoint_returns_counts() -> None:
    app = create_app()
    contacts = [_contact(f"c{i}", f"u{i}@x.com", tenure=90) for i in range(3)]
    db = _FakeDb(contacts)
    ch = _FakeCh([_agg(f"u{i}@x.com", events_30d=2) for i in range(3)], converted=[])
    service = ScoringService(db, ch, conversion_events=[])  # type: ignore[arg-type]
    app.dependency_overrides[get_scoring_service] = lambda: service
    client = TestClient(app)
    response = client.post(
        "/v1/scoring/recompute", json={"organization_id": "o", "workspace_id": "w"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["scored"] == 3
    assert "conversion_method" in body and "churn_method" in body
    # Sanity: the response is JSON-serializable ints, not numpy types.
    assert json.dumps(body)


# --- ClickHouse client -------------------------------------------------------


async def test_clickhouse_client_parses_jsoneachrow() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        captured["body"] = request.content.decode()
        captured["auth"] = request.headers.get("authorization")
        body = '{"email":"a@x.com","total_events":3}\n{"email":"b@x.com","total_events":1}'
        return httpx.Response(200, text=body)

    client = ClickHouseClient("http://ch:8123", user="helio", password="pw", database="helio")
    # Patch the transport used by the client's AsyncClient.
    transport = httpx.MockTransport(handler)
    orig = httpx.AsyncClient.__init__

    def patched(self: httpx.AsyncClient, *a: Any, **k: Any) -> None:
        k["transport"] = transport
        orig(self, *a, **k)

    httpx.AsyncClient.__init__ = patched  # type: ignore[method-assign]
    try:
        rows = await client.query(
            "SELECT * FROM events WHERE workspace_id = {workspace_id:String}",
            {"workspace_id": "ws_a"},
        )
    finally:
        httpx.AsyncClient.__init__ = orig  # type: ignore[method-assign]

    assert rows == [
        {"email": "a@x.com", "total_events": 3},
        {"email": "b@x.com", "total_events": 1},
    ]
    # Server-side parameter and database routing were forwarded.
    assert captured["params"]["param_workspace_id"] == "ws_a"
    assert captured["params"]["database"] == "helio"


async def test_clickhouse_client_empty_response_is_empty_list() -> None:
    client = ClickHouseClient("http://ch:8123", user="u", password="p", database="d")
    transport = httpx.MockTransport(lambda req: httpx.Response(200, text="  "))
    orig = httpx.AsyncClient.__init__

    def patched(self: httpx.AsyncClient, *a: Any, **k: Any) -> None:
        k["transport"] = transport
        orig(self, *a, **k)

    httpx.AsyncClient.__init__ = patched  # type: ignore[method-assign]
    try:
        assert await client.query("SELECT 1") == []
    finally:
        httpx.AsyncClient.__init__ = orig  # type: ignore[method-assign]
