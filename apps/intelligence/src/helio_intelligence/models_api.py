"""HTTP surface for bring-your-own churn models (ADR-0021).

The dashboard owns the `churn_model` rows; this service owns the artifact
bytes and the verdicts. Upload stores the file (pickle refused by magic
byte, 50 MiB cap) and validates it in the sandboxed runtime; the endpoint
variant probes an HTTPS model server with the same sample frame. Every
"no" comes back as a sentence an operator can act on, not a traceback.
"""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .model_runtime import HttpModelError, predict_via_endpoint, validate_artifact
from .model_runtime.storage import (
    MAX_ARTIFACT_BYTES,
    ModelStorageError,
    artifact_path,
    artifact_sha256,
    sniff_rejects,
    store_artifact,
)
from .model_runtime.validator import check_probabilities, sample_matrix
from .scoring.features import FEATURE_NAMES

_EXTENSIONS = {"ONNX": ".onnx", "XGBOOST_JSON": ".json"}


class VerdictResponse(BaseModel):
    """`ok=False` is a *successful* validation that found a problem — the
    web side records it on the model row; transport errors stay 4xx/5xx."""

    ok: bool
    error: str | None = None
    sha256: str | None = None
    size_bytes: int | None = None


class ValidateEndpointRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    url: str = Field(min_length=1, max_length=500)
    auth_header: str | None = Field(default=None, max_length=2000)
    inputs: list[str] = Field(min_length=1, max_length=len(FEATURE_NAMES))


class ArtifactRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    model_id: str = Field(min_length=1, max_length=64)


def create_models_router(*, allow_private_endpoints: bool = False) -> APIRouter:
    router = APIRouter(prefix="/v1/models/churn", tags=["models"])

    @router.post("/upload", response_model=VerdictResponse)
    async def upload(
        file: UploadFile,
        organization_id: Annotated[str, Form(min_length=1, max_length=64)],
        model_id: Annotated[str, Form(min_length=1, max_length=64)],
        model_format: Annotated[str, Form(alias="format")],
        n_inputs: Annotated[int, Form(ge=1, le=len(FEATURE_NAMES))],
    ) -> VerdictResponse:
        extension = _EXTENSIONS.get(model_format)
        if extension is None:
            raise HTTPException(
                status_code=422,
                detail=(
                    "format must be ONNX or XGBOOST_JSON (HTTP models are registered, not uploaded)"
                ),
            )
        # One byte past the cap is enough to know it's oversize without
        # buffering an arbitrarily large body.
        content = await file.read(MAX_ARTIFACT_BYTES + 1)
        problem = sniff_rejects(content, extension)
        if problem is not None:
            raise HTTPException(status_code=422, detail=problem)
        try:
            path = store_artifact(organization_id, model_id, extension, content)
        except ModelStorageError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        # validate_artifact runs a sandboxed child process (blocking wait) —
        # keep the event loop free for health checks meanwhile.
        outcome = await asyncio.to_thread(validate_artifact, model_format, str(path), n_inputs)
        return VerdictResponse(
            ok=outcome.ok,
            error=outcome.error,
            sha256=artifact_sha256(content),
            size_bytes=len(content),
        )

    @router.post("/validate-endpoint", response_model=VerdictResponse)
    async def validate_endpoint(request: ValidateEndpointRequest) -> VerdictResponse:
        unknown = [name for name in request.inputs if name not in FEATURE_NAMES]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"unknown feature names: {', '.join(sorted(set(unknown)))}",
            )
        matrix = sample_matrix(len(request.inputs))
        try:
            predictions = await predict_via_endpoint(
                request.url,
                request.inputs,
                matrix,
                auth_header=request.auth_header,
                allow_private=allow_private_endpoints,
            )
        except HttpModelError as error:
            return VerdictResponse(ok=False, error=str(error))
        return VerdictResponse(
            ok=check_probabilities(predictions, len(matrix)) is None,
            error=check_probabilities(predictions, len(matrix)),
        )

    @router.post("/delete-artifact", response_model=VerdictResponse)
    async def delete_artifact(request: ArtifactRequest) -> VerdictResponse:
        try:
            for extension in _EXTENSIONS.values():
                artifact_path(request.organization_id, request.model_id, extension).unlink(
                    missing_ok=True
                )
        except ModelStorageError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return VerdictResponse(ok=True)

    return router
