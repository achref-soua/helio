"""Per-organization LLM provider resolution (ADR-0019).

Organizations that connected an AI credential in Settings use their own
provider, model, and key — decrypted here, at call time, and never
logged. Everyone else falls back to the deployment's INTEL_LLM_* env
config. Resolutions cache briefly; any failure (missing vault key,
unreadable envelope, bad config) collapses to the deployment fallback so
a credential problem can never take the copilot down for other orgs.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from ..data import Database
from ..settings import Settings
from ..vault import decrypt_field
from .base import LLMProvider
from .factory import build_provider, create_llm_provider

_CACHE_TTL_SECONDS = 60.0

_CREDENTIAL_SQL = (
    "SELECT id, name, config, secrets FROM provider_credential "
    "WHERE kind = 'LLM' "
    "ORDER BY (status = 'VERIFIED') DESC, updated_at DESC LIMIT 1"
)


@dataclass(frozen=True)
class ResolvedLlm:
    provider: LLMProvider
    provider_name: str
    model: str
    temperature: float
    max_tokens: int
    source: str  # "organization" | "deployment"


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


class OrgLlmResolver:
    """Resolves the provider an organization's AI calls should use."""

    def __init__(
        self,
        settings: Settings,
        database: Database | None,
        default_provider: LLMProvider | None,
    ) -> None:
        self._settings = settings
        self._database = database
        self._default = default_provider
        self._cache: dict[str, tuple[float, ResolvedLlm | None]] = {}

    def clear(self) -> None:
        self._cache.clear()

    def deployment(self) -> ResolvedLlm | None:
        if self._default is None:
            return None
        return ResolvedLlm(
            provider=self._default,
            provider_name=self._settings.llm_provider,
            model=self._settings.llm_model,
            temperature=self._settings.llm_temperature,
            max_tokens=self._settings.llm_max_tokens,
            source="deployment",
        )

    async def resolve(self, organization_id: str) -> ResolvedLlm | None:
        cached = self._cache.get(organization_id)
        if cached and time.monotonic() - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]
        resolved = await self._resolve_fresh(organization_id)
        self._cache[organization_id] = (time.monotonic(), resolved)
        return resolved

    async def _resolve_fresh(self, organization_id: str) -> ResolvedLlm | None:
        org = await self._org_credential(organization_id)
        return org if org is not None else self.deployment()

    async def _org_credential(self, organization_id: str) -> ResolvedLlm | None:
        key = self._settings.encryption_key.get_secret_value()
        if not key or self._database is None or not organization_id:
            return None
        try:
            async with self._database.scoped(organization_id) as scoped:
                row = await scoped.fetchrow(_CREDENTIAL_SQL)
            if row is None:
                return None
            config = _as_dict(row["config"])
            secrets = _as_dict(row["secrets"])
            api_key = ""
            envelope = secrets.get("apiKey")
            if isinstance(envelope, str) and envelope:
                previous = self._settings.encryption_key_previous.get_secret_value()
                api_key = decrypt_field(
                    envelope,
                    organization_id=organization_id,
                    credential_id=str(row["id"]),
                    field="apiKey",
                    key_b64=key,
                    previous_key_b64=previous or None,
                )
            provider_name = str(config.get("provider", ""))
            model = str(config.get("model", ""))
            if not provider_name or not model:
                return None
            provider = build_provider(
                provider=provider_name,
                model=model,
                api_key=api_key,
                base_url=str(config.get("baseUrl", "") or ""),
                require_tls=self._settings.llm_require_tls,
            )
            temperature = config.get("temperature")
            max_tokens = config.get("maxTokens")
            return ResolvedLlm(
                provider=provider,
                provider_name=provider_name,
                model=model,
                temperature=(
                    float(temperature)
                    if isinstance(temperature, (int, float))
                    else self._settings.llm_temperature
                ),
                max_tokens=(
                    int(max_tokens)
                    if isinstance(max_tokens, int)
                    else self._settings.llm_max_tokens
                ),
                source="organization",
            )
        except Exception:  # noqa: BLE001 — any failure falls back, never breaks the org
            return None


def build_default_provider(settings: Settings) -> LLMProvider | None:
    """The deployment fallback, or None when env config is absent."""
    if not settings.llm_configured:
        return None
    return create_llm_provider(settings)
