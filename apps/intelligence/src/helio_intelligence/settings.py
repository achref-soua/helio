from functools import lru_cache

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Service configuration; fails fast on invalid values at startup.

    Variables are read from the environment (compose/k8s inject them);
    the INTEL_ prefix keeps them clearly owned by this service.
    """

    model_config = SettingsConfigDict(env_prefix="INTEL_", extra="ignore", populate_by_name=True)

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

    # The deployment's credential-vault key (ADR-0019) — deliberately NOT
    # INTEL_-prefixed: it is the same key every Helio service shares. When
    # set (with the database), organizations that connected an AI provider
    # in Settings use their own key/model; the INTEL_LLM_* values above
    # become the deployment fallback.
    encryption_key: SecretStr = Field(
        SecretStr(""),
        validation_alias=AliasChoices("HELIO_ENCRYPTION_KEY", "INTEL_ENCRYPTION_KEY"),
    )
    encryption_key_previous: SecretStr = Field(
        SecretStr(""),
        validation_alias=AliasChoices(
            "HELIO_ENCRYPTION_KEY_PREVIOUS", "INTEL_ENCRYPTION_KEY_PREVIOUS"
        ),
    )

    # MCP server scope: the single workspace external agents may drive.
    # The server refuses to start without both (it would have no tenant).
    mcp_organization_id: str = ""
    mcp_workspace_id: str = ""

    # ClickHouse (event store) — read-only source of the behavioral
    # features that feed predictive scoring. Empty disables the predictor.
    clickhouse_url: str = "http://localhost:8123"
    clickhouse_user: str = "helio"
    clickhouse_password: SecretStr = SecretStr("helio_dev_password")
    clickhouse_database: str = "helio"
    # Event names that count as a conversion (the positive label for the
    # lead-scoring model). Override per deployment via INTEL_SCORING_
    # CONVERSION_EVENTS as a JSON array. Names are validated before use.
    scoring_conversion_events: list[str] = [
        "Converted",
        "Order Completed",
        "Purchase",
        "Subscription Started",
    ]

    @property
    def scoring_configured(self) -> bool:
        return bool(self.database_url and self.clickhouse_url)

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key.get_secret_value()) or self.llm_provider.lower() in {
            "ollama",
            "local",
        }


@lru_cache
def get_settings() -> Settings:
    # The pydantic-mypy plugin treats alias-bearing fields as required init
    # args even with defaults; they are env-sourced like everything else.
    return Settings()  # type: ignore[call-arg]
