"""The BYO churn-model runtime, exercised with real artifacts: a tiny
XGBoost model and a scikit-learn model exported to ONNX are trained in
the test, then loaded and run through the sandboxed child process."""

from __future__ import annotations

from pathlib import Path

import httpx
import numpy as np
import pytest

from helio_intelligence.model_runtime.http_model import (
    HttpModelError,
    guard_endpoint,
    predict_via_endpoint,
)
from helio_intelligence.model_runtime.runner import ModelRunError, predict_with_artifact
from helio_intelligence.model_runtime.storage import (
    MAX_ARTIFACT_BYTES,
    ModelStorageError,
    artifact_path,
    sniff_rejects,
    store_artifact,
)
from helio_intelligence.model_runtime.validator import (
    check_probabilities,
    sample_matrix,
    validate_artifact,
)
from helio_intelligence.scoring.features import FEATURE_NAMES

N_FEATURES = len(FEATURE_NAMES)


def test_the_feature_contract_matches_core() -> None:
    # packages/core/src/churn-model.ts pins the same literal — change both.
    assert FEATURE_NAMES == (
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


def _training_data() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(7)
    features = rng.random((80, N_FEATURES)).astype(np.float32) * 10
    labels = (features[:, 0] + features[:, 8] > 10).astype(int)
    return features, labels


@pytest.fixture(scope="module")
def xgboost_artifact(tmp_path_factory: pytest.TempPathFactory) -> Path:
    import xgboost as xgb

    features, labels = _training_data()
    booster = xgb.train(
        {"objective": "binary:logistic", "max_depth": 2, "seed": 7},
        xgb.DMatrix(features, label=labels),
        num_boost_round=4,
    )
    path = tmp_path_factory.mktemp("models") / "churn.json"
    booster.save_model(str(path))
    return path


@pytest.fixture(scope="module")
def onnx_artifact(tmp_path_factory: pytest.TempPathFactory) -> Path:
    from skl2onnx import to_onnx
    from sklearn.linear_model import LogisticRegression

    features, labels = _training_data()
    model = LogisticRegression(max_iter=200).fit(features, labels)
    onnx_model = to_onnx(model, features[:1])
    path = tmp_path_factory.mktemp("models") / "churn.onnx"
    path.write_bytes(onnx_model.SerializeToString())
    return path


def test_xgboost_round_trip_through_the_sandbox(xgboost_artifact: Path) -> None:
    matrix = sample_matrix(N_FEATURES)
    predictions = predict_with_artifact("XGBOOST_JSON", str(xgboost_artifact), matrix)
    assert len(predictions) == len(matrix)
    assert all(0.0 <= value <= 1.0 for value in predictions)


def test_onnx_round_trip_handles_zipmap_outputs(onnx_artifact: Path) -> None:
    matrix = sample_matrix(N_FEATURES)
    predictions = predict_with_artifact("ONNX", str(onnx_artifact), matrix)
    assert len(predictions) == len(matrix)
    assert all(0.0 <= value <= 1.0 for value in predictions)


def test_validator_accepts_good_models_and_explains_bad_mappings(
    onnx_artifact: Path, xgboost_artifact: Path
) -> None:
    assert validate_artifact("ONNX", str(onnx_artifact), N_FEATURES).ok
    assert validate_artifact("XGBOOST_JSON", str(xgboost_artifact), N_FEATURES).ok

    # Feed the ONNX model fewer columns than it was trained on.
    outcome = validate_artifact("ONNX", str(onnx_artifact), 4)
    assert not outcome.ok
    assert "feature" in (outcome.error or "").lower()


def test_garbage_artifacts_fail_readably(tmp_path: Path) -> None:
    bogus = tmp_path / "bogus.json"
    bogus.write_text('{"not": "an xgboost model"}')
    with pytest.raises(ModelRunError):
        predict_with_artifact("XGBOOST_JSON", str(bogus), sample_matrix(N_FEATURES))


def test_probability_checks() -> None:
    assert check_probabilities([0.5] * 8, 8) is None
    assert "non-finite" in (check_probabilities([float("nan")] * 8, 8) or "")
    assert "probabilities" in (check_probabilities([7.0] * 8, 8) or "")
    assert "8 rows" in (check_probabilities([0.5], 8) or "")


def test_storage_guards() -> None:
    with pytest.raises(ModelStorageError):
        artifact_path("../escape", "m1", ".onnx")
    with pytest.raises(ModelStorageError):
        artifact_path("org_1", "m1", ".pkl")
    assert "pickle" in (sniff_rejects(b"\x80\x04 evil", ".onnx") or "")
    assert "skl2onnx" in (sniff_rejects(b"\x80\x04 evil", ".onnx") or "")
    assert "JSON" in (sniff_rejects(b"not json", ".json") or "")
    assert sniff_rejects(b"x" * (MAX_ARTIFACT_BYTES + 1), ".onnx") is not None
    assert sniff_rejects(b'{"learner": {}}', ".json") is None


def test_store_artifact_writes_atomically(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTEL_MODELS_PATH", str(tmp_path))
    path = store_artifact("org_1", "chm_1", ".json", b'{"learner": {}}')
    assert path.read_bytes() == b'{"learner": {}}'
    assert not list(tmp_path.glob("**/*.tmp"))


def test_endpoint_guard_blocks_private_targets() -> None:
    with pytest.raises(HttpModelError, match="https"):
        guard_endpoint("http://models.example.com/churn", allow_private=False)
    with pytest.raises(HttpModelError, match="private"):
        guard_endpoint("https://127.0.0.1/churn", allow_private=False)
    guard_endpoint("http://10.0.0.5:8000/churn", allow_private=True)  # no raise


async def test_endpoint_predicts_in_chunks_and_validates_the_reply() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read().decode()
        import json

        rows = json.loads(body)["inputs"]
        calls.append(len(rows))
        return httpx.Response(200, json={"predictions": [0.5] * len(rows)})

    matrix = [[0.0] * N_FEATURES] * 12_000
    predictions = await predict_via_endpoint(
        "https://models.example.com/churn",
        list(FEATURE_NAMES),
        matrix,
        transport=httpx.MockTransport(handler),
    )
    assert len(predictions) == 12_000
    assert calls == [5_000, 5_000, 2_000]

    def bad_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"predictions": [0.1]})

    with pytest.raises(HttpModelError, match="one value per row"):
        await predict_via_endpoint(
            "https://models.example.com/churn",
            list(FEATURE_NAMES),
            [[0.0] * N_FEATURES] * 3,
            transport=httpx.MockTransport(bad_handler),
        )
