"""HTTP surface for NL→segment and NL→journey generation.

Both return a draft the dashboard can review and save through the normal
TypeScript APIs (which re-validate). Generation itself is schema-driven;
journey generation is grounded in the caller's own templates.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .agent import OrgScope
from .agent.nl_journey import NlJourneyGenerator
from .agent.nl_segment import NlSegmentGenerator
from .data import OrgRepository


class SegmentRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    workspace_id: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=2000)


class SegmentResponse(BaseModel):
    name: str
    rule: dict[str, Any]


class JourneyRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    workspace_id: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=2000)


class JourneyResponse(BaseModel):
    name: str
    definition: dict[str, Any]


def get_segment_generator() -> NlSegmentGenerator:
    raise HTTPException(
        status_code=503, detail="generation is not configured (set INTEL_LLM_API_KEY)"
    )


def get_journey_generator() -> NlJourneyGenerator:
    raise HTTPException(
        status_code=503, detail="generation is not configured (set INTEL_LLM_API_KEY)"
    )


def get_repository() -> OrgRepository:
    raise HTTPException(
        status_code=503, detail="database is not configured (set INTEL_DATABASE_URL)"
    )


def create_generation_router() -> APIRouter:
    router = APIRouter(prefix="/v1/copilot", tags=["generation"])

    @router.post("/segment", response_model=SegmentResponse)
    async def nl_to_segment(
        request: SegmentRequest,
        generator: Annotated[NlSegmentGenerator, Depends(get_segment_generator)],
    ) -> SegmentResponse:
        try:
            result = await generator.generate(request.prompt)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return SegmentResponse(name=result.name, rule=result.rule)

    @router.post("/journey", response_model=JourneyResponse)
    async def nl_to_journey(
        request: JourneyRequest,
        generator: Annotated[NlJourneyGenerator, Depends(get_journey_generator)],
        repository: Annotated[OrgRepository, Depends(get_repository)],
    ) -> JourneyResponse:
        scope = OrgScope(request.organization_id, request.workspace_id)
        templates = await repository.template_options(scope.organization_id, scope.workspace_id)
        try:
            result = await generator.generate(request.prompt, templates)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return JourneyResponse(name=result.name, definition=result.definition)

    return router
