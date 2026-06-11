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


def _enforce_tls_for(require_tls: bool, base_url: str | None) -> None:
    if not require_tls or not base_url:
        return
    parsed = urlparse(base_url)
    if parsed.scheme == "http" and not _is_local_host(base_url):
        raise ValueError(
            f"refusing to send prompts over plaintext HTTP to '{base_url}'. "
            "Use https, point at a local host, or set INTEL_LLM_REQUIRE_TLS=false "
            "(only on a trusted private network)."
        )


def build_provider(
    *,
    provider: str,
    model: str,
    api_key: str,
    base_url: str = "",
    require_tls: bool = True,
) -> LLMProvider:
    """Build a provider from explicit values (deployment env or an org
    credential); raises on misconfiguration. The TLS guard applies to both
    paths."""
    name = provider.lower()

    if name in _HOSTED and not api_key:
        raise ValueError(
            f"an API key is required for provider '{name}'. "
            "Set INTEL_LLM_API_KEY or store one on the organization's AI credential."
        )

    if name == "anthropic":
        _enforce_tls_for(require_tls, base_url or None)
        return AnthropicProvider(
            api_key=api_key,
            model=model,
            base_url=base_url or None,
            name="anthropic",
        )

    if name in _HOSTED or name in _LOCAL:
        # Imported lazily so the anthropic-only path needn't load it.
        from .openai_compatible import OpenAICompatibleProvider

        if base_url:
            resolved_base: str | None = base_url
        elif name == "groq":
            resolved_base = _GROQ_BASE_URL
        elif name in _LOCAL:
            resolved_base = _OLLAMA_BASE_URL
        else:
            resolved_base = None  # OpenAI default

        _enforce_tls_for(require_tls, resolved_base)
        return OpenAICompatibleProvider(
            api_key=api_key or _LOCAL_KEY_SENTINEL,
            model=model,
            base_url=resolved_base,
            name=name,
        )

    raise ValueError(
        f"Unknown LLM provider '{name}'. Supported: openai, anthropic, groq, ollama, local."
    )


def create_llm_provider(settings: Settings) -> LLMProvider:
    """Build the deployment-configured provider from settings."""
    return build_provider(
        provider=settings.llm_provider,
        model=settings.llm_model,
        api_key=settings.llm_api_key.get_secret_value(),
        base_url=settings.llm_base_url,
        require_tls=settings.llm_require_tls,
    )
