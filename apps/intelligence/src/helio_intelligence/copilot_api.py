"""HTTP surface for the agentic copilot.

The organization and workspace ids are taken from the request body: in
production the dashboard BFF authenticates the user and passes the
*verified* ids, and the intelligence service is reachable only from
inside the trust boundary. The RLS data layer is the backstop — even a
forged id cannot read another tenant's rows.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .agent import Copilot, OrgScope
from .llm import AssistantMessage, Message, SystemMessage, UserMessage


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    workspace_id: str = Field(min_length=1, max_length=64)
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class ChatResponse(BaseModel):
    text: str
    tool_calls_made: int
    iterations: int


def _to_history(messages: list[ChatMessage]) -> list[Message]:
    history: list[Message] = []
    for message in messages:
        if message.role == "user":
            history.append(UserMessage(message.content))
        elif message.role == "assistant":
            history.append(AssistantMessage(content=message.content))
        else:
            history.append(SystemMessage(message.content))
    return history


def get_copilot() -> Copilot:
    """Overridden in app wiring and in tests; 503 until configured."""
    raise HTTPException(
        status_code=503,
        detail="copilot is not configured (set INTEL_LLM_API_KEY and INTEL_DATABASE_URL)",
    )


def create_copilot_router() -> APIRouter:
    router = APIRouter(prefix="/v1/copilot", tags=["copilot"])

    @router.post("/chat", response_model=ChatResponse)
    async def chat(
        request: ChatRequest,
        copilot: Annotated[Copilot, Depends(get_copilot)],
    ) -> ChatResponse:
        scope = OrgScope(
            organization_id=request.organization_id,
            workspace_id=request.workspace_id,
        )
        reply = await copilot.chat(scope, _to_history(request.messages))
        return ChatResponse(
            text=reply.text,
            tool_calls_made=reply.tool_calls_made,
            iterations=reply.iterations,
        )

    return router
