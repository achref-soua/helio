import os
import time

import structlog
from fastapi import FastAPI, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Histogram, generate_latest

from .logging import configure_logging
from .settings import get_settings

log = structlog.get_logger()


def release_identity() -> tuple[str, str | None]:
    """Version/commit baked into release images (HELIO_VERSION / HELIO_COMMIT).

    Source checkouts report ("dev", None) — the same contract as
    @helio/core's healthPayload on the TypeScript services.
    """
    version = (os.environ.get("HELIO_VERSION") or "").strip().removeprefix("v") or "dev"
    commit = (os.environ.get("HELIO_COMMIT") or "").strip()[:12] or None
    return version, commit


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

    # The copilot and generators need an LLM (and the copilot the
    # database). The routes are always registered — they return an
    # actionable 503 until configured, so the service still boots for
    # health checks and metrics on a bare deploy.
    from .copilot_api import create_copilot_router
    from .generation_api import create_generation_router
    from .scoring_api import create_scoring_router

    app.include_router(create_copilot_router())
    app.include_router(create_generation_router())
    app.include_router(create_scoring_router())

    # The database pool is shared by the copilot and the scorer; create it
    # once if either is configured.
    from .data import Database

    database = Database(settings.database_url) if settings.database_url else None
    app.state.database = database

    # AI surfaces come up when a database exists and there is at least one
    # possible provider: the deployment INTEL_LLM_* config, or org-connected
    # credentials (which need the shared vault key to open). Which provider
    # actually serves a request is resolved per organization (ADR-0019).
    vault_key_present = bool(settings.encryption_key.get_secret_value())
    llm_resolver = None
    if database is not None and (settings.llm_configured or vault_key_present):
        from .agent import Copilot
        from .agent.nl_email import NlEmailGenerator
        from .agent.nl_journey import NlJourneyGenerator
        from .agent.nl_segment import NlSegmentGenerator
        from .copilot_api import get_copilot
        from .data import OrgRepository
        from .generation_api import (
            get_email_generator,
            get_journey_generator,
            get_repository,
            get_segment_generator,
        )
        from .llm.org_provider import OrgLlmResolver, build_default_provider

        repository = OrgRepository(database)
        llm_resolver = OrgLlmResolver(settings, database, build_default_provider(settings))
        app.state.llm_resolver = llm_resolver

        async def _resolved_for(request: Request):  # type: ignore[no-untyped-def]
            # Starlette caches the body, so the endpoint's own parse is free.
            try:
                body = await request.json()
            except Exception:  # noqa: BLE001 — malformed body → 422 later
                body = {}
            organization_id = str(body.get("organization_id", "") or "")
            resolved = await llm_resolver.resolve(organization_id)
            if resolved is None:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "no AI provider is configured — set INTEL_LLM_API_KEY on the "
                        "deployment or connect one under Settings → Provider credentials"
                    ),
                )
            return resolved

        async def routed_copilot(request: Request) -> Copilot:
            resolved = await _resolved_for(request)
            return Copilot(
                provider=resolved.provider,
                repository=repository,
                temperature=resolved.temperature,
                max_tokens=resolved.max_tokens,
            )

        async def routed_segment_generator(request: Request) -> NlSegmentGenerator:
            return NlSegmentGenerator((await _resolved_for(request)).provider)

        async def routed_journey_generator(request: Request) -> NlJourneyGenerator:
            return NlJourneyGenerator((await _resolved_for(request)).provider)

        async def routed_email_generator(request: Request) -> NlEmailGenerator:
            return NlEmailGenerator((await _resolved_for(request)).provider)

        app.dependency_overrides[get_copilot] = routed_copilot
        app.dependency_overrides[get_segment_generator] = routed_segment_generator
        app.dependency_overrides[get_journey_generator] = routed_journey_generator
        app.dependency_overrides[get_email_generator] = routed_email_generator
        app.dependency_overrides[get_repository] = lambda: repository

    if settings.scoring_configured and database is not None:
        from .scoring import ClickHouseClient, ScoringService
        from .scoring_api import get_scoring_service

        clickhouse = ClickHouseClient(
            settings.clickhouse_url,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password.get_secret_value(),
            database=settings.clickhouse_database,
        )
        scoring_service = ScoringService(
            database,
            clickhouse,
            conversion_events=settings.scoring_conversion_events,
        )
        app.dependency_overrides[get_scoring_service] = lambda: scoring_service

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
    def healthz() -> dict[str, str | None]:
        version, commit = release_identity()
        return {
            "status": "ok",
            "service": settings.service_name,
            "version": version,
            "commit": commit,
        }

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

    @app.post("/v1/llm/config")
    async def llm_config_for_org(body: dict[str, str]) -> dict[str, object]:
        # The org-aware variant: which provider would actually serve this
        # organization (its own credential, or the deployment fallback).
        organization_id = str(body.get("organization_id", "") or "")
        resolver = getattr(app.state, "llm_resolver", None)
        resolved = await resolver.resolve(organization_id) if resolver else None
        if resolved is None:
            return {
                "provider": settings.llm_provider,
                "model": settings.llm_model,
                "configured": settings.llm_configured,
                "source": "deployment",
            }
        return {
            "provider": resolved.provider_name,
            "model": resolved.model,
            "configured": True,
            "source": resolved.source,
        }

    log.info("intelligence app created", service=settings.service_name)
    return app


app = create_app()
