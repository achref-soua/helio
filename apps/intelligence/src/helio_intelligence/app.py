import structlog
from fastapi import FastAPI

from .logging import configure_logging
from .settings import get_settings

log = structlog.get_logger()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Helio Intelligence",
        version="0.1.0",
        description=(
            "The intelligence plane: AI copilot, predictive scoring, segment "
            "compute, and the MCP server land here in later milestones."
        ),
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        # No backing dependencies yet; reports ok so orchestration can
        # already use the endpoint. Dependency checks land with the first
        # real feature (ClickHouse/Postgres access).
        return {"status": "ok", "service": settings.service_name}

    log.info("intelligence app created", service=settings.service_name)
    return app


app = create_app()
