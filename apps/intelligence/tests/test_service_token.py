import pytest
from fastapi.testclient import TestClient

from helio_intelligence import create_app
from helio_intelligence.settings import get_settings


@pytest.fixture(autouse=True)
def _isolate_settings_cache():
    # get_settings() is lru_cached; clear it around each test so the token env
    # set here is read fresh and never leaks into other test modules.
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _client(monkeypatch, token: str | None) -> TestClient:
    if token is None:
        monkeypatch.delenv("INTEL_SERVICE_TOKEN", raising=False)
    else:
        monkeypatch.setenv("INTEL_SERVICE_TOKEN", token)
    get_settings.cache_clear()
    return TestClient(create_app())


def test_v1_rejects_missing_or_wrong_token(monkeypatch) -> None:
    client = _client(monkeypatch, "shared-service-token")
    assert client.get("/v1/llm/config").status_code == 401
    wrong = client.get("/v1/llm/config", headers={"x-helio-service-token": "nope"})
    assert wrong.status_code == 401


def test_v1_accepts_the_matching_token(monkeypatch) -> None:
    client = _client(monkeypatch, "shared-service-token")
    ok = client.get("/v1/llm/config", headers={"x-helio-service-token": "shared-service-token"})
    assert ok.status_code == 200


def test_v1_open_when_token_unset(monkeypatch) -> None:
    client = _client(monkeypatch, None)
    assert client.get("/v1/llm/config").status_code == 200


def test_health_and_metrics_never_require_a_token(monkeypatch) -> None:
    client = _client(monkeypatch, "shared-service-token")
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 200
    assert client.get("/metrics").status_code == 200
