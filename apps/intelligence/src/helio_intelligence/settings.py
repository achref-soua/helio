from functools import lru_cache

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
