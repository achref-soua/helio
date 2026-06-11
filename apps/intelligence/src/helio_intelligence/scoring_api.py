"""HTTP surface for predictive scoring.

A single recompute endpoint: train and write conversion-propensity and
churn-risk for one workspace. The dashboard triggers it on demand (and a
scheduler can hit it nightly). Like the copilot routes it 503s until the
data plane is configured, and forwards only the *verified* tenant.
"""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .scoring import ScoringService


class RecomputeRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    workspace_id: str = Field(min_length=1, max_length=64)


class FeaturesExportRequest(RecomputeRequest):
    # Emails are PII — exporting them is an explicit opt-in.
    include_email: bool = False


class RecomputeResponse(BaseModel):
    scored: int
    conversion_method: str
    churn_method: str
    converted: int
    churned: int
    send_hour_fallback: int


def get_scoring_service() -> ScoringService:
    raise HTTPException(
        status_code=503,
        detail="scoring is not configured (set INTEL_DATABASE_URL and INTEL_CLICKHOUSE_URL)",
    )


def create_scoring_router() -> APIRouter:
    router = APIRouter(prefix="/v1/scoring", tags=["scoring"])

    @router.post("/recompute", response_model=RecomputeResponse)
    async def recompute(
        request: RecomputeRequest,
        service: Annotated[ScoringService, Depends(get_scoring_service)],
    ) -> RecomputeResponse:
        try:
            result = await service.recompute(request.organization_id, request.workspace_id)
        except httpx.HTTPError as error:
            # Configured-but-unreachable analytics store is an operational
            # state, not a crash: tell the operator what to start.
            raise HTTPException(
                status_code=503,
                detail=(
                    "the analytics store (ClickHouse) is unreachable — "
                    "start the full stack (task up:full) and retry"
                ),
            ) from error
        return RecomputeResponse(
            scored=result.scored,
            conversion_method=result.conversion_method,
            churn_method=result.churn_method,
            converted=result.converted,
            churned=result.churned,
            send_hour_fallback=result.send_hour_fallback,
        )

    @router.post("/features-export")
    async def features_export(
        request: FeaturesExportRequest,
        service: Annotated[ScoringService, Depends(get_scoring_service)],
    ) -> Response:
        """The training CSV for bring-your-own churn models: the exact
        feature columns the runtime feeds a model, plus `churned_label`."""
        try:
            content = await service.export_features(
                request.organization_id,
                request.workspace_id,
                include_email=request.include_email,
            )
        except httpx.HTTPError as error:
            raise HTTPException(
                status_code=503,
                detail=(
                    "the analytics store (ClickHouse) is unreachable — "
                    "start the full stack (task up:full) and retry"
                ),
            ) from error
        return Response(
            content=content,
            media_type="text/csv",
            headers={"content-disposition": 'attachment; filename="churn-training-data.csv"'},
        )

    return router
