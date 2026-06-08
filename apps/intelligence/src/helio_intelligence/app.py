import time

import structlog
from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Histogram, generate_latest

from .logging import configure_logging
from .settings import get_settings

log = structlog.get_logger()

REQUEST_DURATION = Histogram(
    "helio_intelligence_http_request_duration_seconds",
    "HTTP request duration by route, method, and status",
    labelnames=("method", "route", "status"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5),
)


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

    # The copilot needs both an LLM and the database; wire it only when
    # both are configured so the service still boots for health checks
    # and metrics on a bare deploy.
    if settings.llm_configured and settings.database_url:
        from .agent import Copilot
        from .copilot_api import create_copilot_router, get_copilot
        from .data import Database, OrgRepository
        from .llm import create_llm_provider

        database = Database(settings.database_url)
        repository = OrgRepository(database)
        provider = create_llm_provider(settings)

        def _build_copilot() -> Copilot:
            return Copilot(
                provider=provider,
                repository=repository,
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
            )

        app.dependency_overrides[get_copilot] = _build_copilot
        app.include_router(create_copilot_router())
        app.state.database = database
    else:
        # Still expose the route so callers get an actionable 503.
        from .copilot_api import create_copilot_router

        app.include_router(create_copilot_router())
        app.state.database = None

    @app.middleware("http")
    async def observe_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
        started = time.perf_counter()
        response: Response = await call_next(request)
        duration = time.perf_counter() - started
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        REQUEST_DURATION.labels(
            method=request.method, route=route_path, status=str(response.status_code)
        ).observe(duration)
        log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration * 1000),
        )
        return response

    @app.get("/metrics")
    def metrics() -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_name}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        # No backing dependencies yet; reports ok so orchestration can
        # already use the endpoint. Dependency checks land with the first
        # real feature (ClickHouse/Postgres access).
        return {"status": "ok", "service": settings.service_name}

    @app.get("/v1/llm/config")
    def llm_config() -> dict[str, object]:
        # Surfaces which provider/model the copilot will use, without ever
        # echoing the key — handy for the dashboard and for deploy checks.
        return {
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "configured": settings.llm_configured,
        }

    log.info("intelligence app created", service=settings.service_name)
    return app


app = create_app()
