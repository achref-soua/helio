"""OpenAI-compatible provider — serves OpenAI and Groq (and local servers).

Groq exposes the same Chat Completions surface as OpenAI, so a single
implementation covers both; only ``base_url`` and the model id differ.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from openai import AsyncOpenAI

from .types import (
    LLMResponse,
    Message,
    SystemMessage,
    ToolCall,
    ToolMessage,
    ToolSpec,
    Usage,
    UserMessage,
)


def _to_openai_message(message: Message) -> dict[str, Any]:
    if isinstance(message, SystemMessage):
        return {"role": "system", "content": message.content}
    if isinstance(message, UserMessage):
        return {"role": "user", "content": message.content}
    if isinstance(message, ToolMessage):
        return {
            "role": "tool",
            "tool_call_id": message.tool_call_id,
            "content": message.content,
        }
    # AssistantMessage — may carry tool calls.
    payload: dict[str, Any] = {"role": "assistant", "content": message.content or None}
    if message.tool_calls:
        payload["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
            }
            for call in message.tool_calls
        ]
    return payload


def _to_openai_tool(tool: ToolSpec) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        },
    }


class OpenAICompatibleProvider:
    """Chat completions over any OpenAI-compatible endpoint."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str | None = None,
        name: str = "openai",
        timeout: float = 60.0,
    ) -> None:
        self.name = name
        self.model = model
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout)

    async def complete(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": [_to_openai_message(message) for message in messages],
        }
        if tools:
            kwargs["tools"] = [_to_openai_tool(tool) for tool in tools]
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        completion = await self._client.chat.completions.create(**kwargs)
        choice = completion.choices[0]
        message = choice.message

        tool_calls: list[ToolCall] = []
        for raw in message.tool_calls or []:
            try:
                arguments = json.loads(raw.function.arguments or "{}")
            except json.JSONDecodeError:
                arguments = {}
            tool_calls.append(ToolCall(id=raw.id, name=raw.function.name, arguments=arguments))

        usage = Usage(
            prompt_tokens=getattr(completion.usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(completion.usage, "completion_tokens", 0) or 0,
        )
        return LLMResponse(
            text=message.content or "",
            tool_calls=tuple(tool_calls),
            finish_reason=choice.finish_reason or "stop",
            usage=usage,
        )
