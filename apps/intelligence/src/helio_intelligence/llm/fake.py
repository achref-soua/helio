"""A scriptable in-memory provider for tests and local development.

It never makes a network call: callers enqueue the responses the model
should return, and the provider replays them in order while recording
every request it received.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence

from .types import LLMResponse, Message, ToolSpec


class FakeProvider:
    """Returns pre-scripted responses; records calls for assertions."""

    def __init__(
        self,
        responses: Sequence[LLMResponse] | None = None,
        *,
        name: str = "fake",
        model: str = "fake-model",
    ) -> None:
        self.name = name
        self.model = model
        self._responses: deque[LLMResponse] = deque(responses or [])
        self.calls: list[dict[str, object]] = []

    def enqueue(self, *responses: LLMResponse) -> None:
        self._responses.extend(responses)

    async def complete(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        self.calls.append(
            {
                "messages": list(messages),
                "tools": list(tools or []),
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
        )
        if not self._responses:
            return LLMResponse(text="")
        return self._responses.popleft()
