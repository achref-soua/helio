from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Service configuration; fails fast on invalid values at startup.

    Variables are read from the environment (compose/k8s inject them);
    the INTEL_ prefix keeps them clearly owned by this service.
    """

    model_config = SettingsConfigDict(env_prefix="INTEL_", extra="ignore")

    port: int = 8000
    log_level: str = "info"
    service_name: str = "intelligence"

    # Domain data: the RLS-bound app connection (helio_app role). Every
    # copilot read runs inside a transaction that sets app.org_id, so the
    # database physically prevents cross-organization access — the copilot
    # can never see another tenant's data, even on a buggy query.
    database_url: str = ""

    # LLM gateway (provider-agnostic: openai | anthropic | groq | ollama
    # | local). Test target is Llama 3 via Groq; local/ollama point at a
    # self-hosted OpenAI-compatible server for full data sovereignty.
    # The key is a SecretStr so it never lands in logs or reprs. Never
    # commit a real key — set INTEL_LLM_API_KEY in the environment.
    llm_provider: str = "groq"
    llm_model: str = "llama-3.3-70b-versatile"
    llm_api_key: SecretStr = SecretStr("")
    # Optional base-URL override (e.g. a local OpenAI-compatible server).
    llm_base_url: str = ""
    llm_temperature: float = 0.2
    llm_max_tokens: int = 1024
    # Security: refuse to send prompts/data over plaintext HTTP to a
    # non-local endpoint. Local hosts (localhost/127.0.0.1) are exempt so
    # self-hosted LLMs work out of the box.
    llm_require_tls: bool = True

    # MCP server scope: the single workspace external agents may drive.
    # The server refuses to start without both (it would have no tenant).
    mcp_organization_id: str = ""
    mcp_workspace_id: str = ""

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key.get_secret_value()) or self.llm_provider.lower() in {
            "ollama",
            "local",
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
