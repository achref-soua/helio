"""Per-organization LLM resolution: org credential wins, everything else
falls back to the deployment provider, and failures never raise."""

from __future__ import annotations

import base64
import hashlib
import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi.testclient import TestClient
from pydantic import SecretStr

from helio_intelligence import create_app
from helio_intelligence.llm.fake import FakeProvider
from helio_intelligence.llm.org_provider import OrgLlmResolver
from helio_intelligence.settings import Settings
from helio_intelligence.vault import encrypt_field

# Deterministic, obviously-non-secret test key (derived from a public label).
KEY = base64.b64encode(hashlib.sha256(b"helio-org-provider-test-key").digest()).decode()


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "llm_provider": "groq",
        "llm_model": "deploy-model",
        "llm_api_key": SecretStr("deploy-key"),
        "encryption_key": SecretStr(KEY),
    }
    values.update(overrides)
    return Settings(**values)


class _Scoped:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        return self._row


class _Db:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row
        self.orgs: list[str] = []

    @asynccontextmanager
    async def scoped(self, organization_id: str):  # type: ignore[no-untyped-def]
        self.orgs.append(organization_id)
        yield _Scoped(self._row)


def _credential_row(org: str) -> dict[str, Any]:
    sealed = encrypt_field(
        "org-groq-key",
        organization_id=org,
        credential_id="cred_llm_1",
        field="apiKey",
        key_b64=KEY,
    )
    return {
        "id": "cred_llm_1",
        "name": "Org AI",
        "config": json.dumps(
            {"provider": "groq", "model": "org-model", "temperature": 0.5, "maxTokens": 256}
        ),
        "secrets": json.dumps({"apiKey": sealed}),
    }


async def test_org_credential_wins_and_caches() -> None:
    db = _Db(_credential_row("org_a"))
    resolver = OrgLlmResolver(_settings(), db, FakeProvider([]))  # type: ignore[arg-type]
    resolved = await resolver.resolve("org_a")
    assert resolved is not None
    assert resolved.source == "organization"
    assert resolved.model == "org-model"
    assert resolved.temperature == 0.5
    assert resolved.max_tokens == 256

    await resolver.resolve("org_a")
    assert db.orgs == ["org_a"]  # second hit served from cache


async def test_falls_back_to_deployment_without_a_credential() -> None:
    deployment = FakeProvider([])
    resolver = OrgLlmResolver(_settings(), _Db(None), deployment)  # type: ignore[arg-type]
    resolved = await resolver.resolve("org_a")
    assert resolved is not None
    assert resolved.source == "deployment"
    assert resolved.provider is deployment
    assert resolved.model == "deploy-model"


async def test_unreadable_secret_falls_back_instead_of_failing() -> None:
    row = _credential_row("org_a")
    other_key = base64.b64encode(hashlib.sha256(b"some-other-key").digest()).decode()
    resolver = OrgLlmResolver(
        _settings(encryption_key=SecretStr(other_key)),
        _Db(row),  # type: ignore[arg-type]
        FakeProvider([]),
    )
    resolved = await resolver.resolve("org_a")
    assert resolved is not None
    assert resolved.source == "deployment"


async def test_no_provider_anywhere_resolves_to_none() -> None:
    resolver = OrgLlmResolver(_settings(llm_api_key=SecretStr("")), _Db(None), None)  # type: ignore[arg-type]
    assert await resolver.resolve("org_a") is None


def test_org_aware_config_endpoint_reports_the_deployment_default() -> None:
    client = TestClient(create_app())
    response = client.post("/v1/llm/config", json={"organization_id": "org_a"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "deployment"
    assert "api_key" not in body
