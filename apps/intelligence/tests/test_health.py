from fastapi.testclient import TestClient

from helio_intelligence import create_app


def test_healthz_reports_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/healthz")
    assert response.status_code == 200
    # Source checkouts report "dev"; release images bake HELIO_VERSION.
    assert response.json() == {
        "status": "ok",
        "service": "intelligence",
        "version": "dev",
        "commit": None,
    }


def test_healthz_reports_the_baked_release(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("HELIO_VERSION", "v2.0.0")
    monkeypatch.setenv("HELIO_COMMIT", "abcdef0123456789")
    client = TestClient(create_app())
    body = client.get("/healthz").json()
    assert body["version"] == "2.0.0"
    assert body["commit"] == "abcdef012345"


def test_readyz_reports_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_openapi_document_is_served() -> None:
    client = TestClient(create_app())
    response = client.get("/openapi.json")
    assert response.status_code == 200
    document = response.json()
    assert document["info"]["title"] == "Helio Intelligence"
    assert "/healthz" in document["paths"]


def test_metrics_expose_request_histogram() -> None:
    client = TestClient(create_app())
    client.get("/healthz")
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "helio_intelligence_http_request_duration_seconds" in response.text


def test_settings_respect_environment(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from helio_intelligence.settings import Settings

    monkeypatch.setenv("INTEL_PORT", "9001")
    monkeypatch.setenv("INTEL_SERVICE_NAME", "intel-test")
    settings = Settings()
    assert settings.port == 9001
    assert settings.service_name == "intel-test"


def test_llm_config_reports_provider_without_leaking_the_key() -> None:
    client = TestClient(create_app())
    response = client.get("/v1/llm/config")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"provider", "model", "configured"}
    assert "api_key" not in body
