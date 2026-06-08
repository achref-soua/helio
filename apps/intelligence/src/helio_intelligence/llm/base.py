"""The provider boundary the rest of the service depends on."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from .types import LLMResponse, Message, ToolSpec


@runtime_checkable
class LLMProvider(Protocol):
    """A chat completion provider with optional tool calling.

    Implementations are stateless and safe to share across requests.
    """

    name: str
    model: str

    async def complete(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        """Run one completion turn and return the model's response."""
        ...
