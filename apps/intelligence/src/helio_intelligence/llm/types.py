"""Vendor-neutral message and tool-calling types.

These shapes are translated to and from each provider's wire format by
the concrete providers, so the agent loop never sees vendor specifics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["system", "user", "assistant", "tool"]


@dataclass(frozen=True)
class ToolSpec:
    """A tool the model may call. ``parameters`` is a JSON Schema object."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    """A model's request to invoke a tool."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class SystemMessage:
    content: str
    role: Literal["system"] = "system"


@dataclass(frozen=True)
class UserMessage:
    content: str
    role: Literal["user"] = "user"


@dataclass(frozen=True)
class AssistantMessage:
    content: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    role: Literal["assistant"] = "assistant"


@dataclass(frozen=True)
class ToolMessage:
    """The result of a tool call, fed back to the model."""

    tool_call_id: str
    content: str
    role: Literal["tool"] = "tool"


Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage


@dataclass(frozen=True)
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass(frozen=True)
class LLMResponse:
    """A single model turn: free text and/or tool calls."""

    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    finish_reason: str = "stop"
    usage: Usage = field(default_factory=Usage)

    @property
    def wants_tools(self) -> bool:
        return len(self.tool_calls) > 0
