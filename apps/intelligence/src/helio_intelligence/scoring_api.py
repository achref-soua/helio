"""HTTP surface for predictive scoring.

A single recompute endpoint: train and write conversion-propensity and
churn-risk for one workspace. The dashboard triggers it on demand (and a
scheduler can hit it nightly). Like the copilot routes it 503s until the
data plane is configured, and forwards only the *verified* tenant.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .scoring import ScoringService


class RecomputeRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    workspace_id: str = Field(min_length=1, max_length=64)


class RecomputeResponse(BaseModel):
    scored: int
    conversion_method: str
    churn_method: str
    converted: int
    churned: int


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
        result = await service.recompute(request.organization_id, request.workspace_id)
        return RecomputeResponse(
            scored=result.scored,
            conversion_method=result.conversion_method,
            churn_method=result.churn_method,
            converted=result.converted,
            churned=result.churned,
        )

    return router
