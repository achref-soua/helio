"""Construct an :class:`LLMProvider` from settings.

Vendor selection plus the security guards that make remote calls safe by
default: a missing key fails fast for hosted providers, and prompts are
never sent over plaintext HTTP to a non-local endpoint.
"""

from __future__ import annotations

from urllib.parse import urlparse

from ..settings import Settings
from .anthropic_provider import AnthropicProvider
from .base import LLMProvider

# Groq and Ollama are OpenAI-compatible; only the base URL differs.
_GROQ_BASE_URL = "https://api.groq.com/openai/v1"
_OLLAMA_BASE_URL = "http://localhost:11434/v1"
_LOCAL_KEY_SENTINEL = "local"  # OpenAI SDK requires a non-empty key string

_HOSTED = {"openai", "anthropic", "groq"}
_LOCAL = {"ollama", "local"}


def _is_local_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _enforce_tls(settings: Settings, base_url: str | None) -> None:
    """Reject sending data over plaintext HTTP to a remote endpoint."""
    if not settings.llm_require_tls or not base_url:
        return
    parsed = urlparse(base_url)
    if parsed.scheme == "http" and not _is_local_host(base_url):
        raise ValueError(
            f"refusing to send prompts over plaintext HTTP to '{base_url}'. "
            "Use https, point at a local host, or set INTEL_LLM_REQUIRE_TLS=false "
            "(only on a trusted private network)."
        )


def create_llm_provider(settings: Settings) -> LLMProvider:
    """Build the configured provider, or raise if it is misconfigured."""
    provider = settings.llm_provider.lower()
    key = settings.llm_api_key.get_secret_value()

    if provider in _HOSTED and not key:
        raise ValueError(
            f"INTEL_LLM_API_KEY is required for provider '{provider}'. "
            "Set it in the environment (see .env.example)."
        )

    if provider == "anthropic":
        _enforce_tls(settings, settings.llm_base_url or None)
        return AnthropicProvider(
            api_key=key,
            model=settings.llm_model,
            base_url=settings.llm_base_url or None,
            name="anthropic",
        )

    if provider in _HOSTED or provider in _LOCAL:
        # Imported lazily so the anthropic-only path needn't load it.
        from .openai_compatible import OpenAICompatibleProvider

        if settings.llm_base_url:
            base_url: str | None = settings.llm_base_url
        elif provider == "groq":
            base_url = _GROQ_BASE_URL
        elif provider in _LOCAL:
            base_url = _OLLAMA_BASE_URL
        else:
            base_url = None  # OpenAI default

        _enforce_tls(settings, base_url)
        return OpenAICompatibleProvider(
            api_key=key or _LOCAL_KEY_SENTINEL,
            model=settings.llm_model,
            base_url=base_url,
            name=provider,
        )

    raise ValueError(
        f"Unknown INTEL_LLM_PROVIDER '{provider}'. "
        "Supported: openai, anthropic, groq, ollama, local."
    )
