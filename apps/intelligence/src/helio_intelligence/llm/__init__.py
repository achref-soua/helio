"""Provider-agnostic LLM gateway (OpenAI, Anthropic, Groq).

The rest of the service talks to :class:`LLMProvider`; vendors are an
implementation detail selected by configuration. Tool calling is unified
so the agent loop is written once.
"""

from .base import LLMProvider
from .factory import create_llm_provider
from .types import (
    AssistantMessage,
    LLMResponse,
    Message,
    SystemMessage,
    ToolCall,
    ToolMessage,
    ToolSpec,
    UserMessage,
)

__all__ = [
    "LLMProvider",
    "LLMResponse",
    "Message",
    "SystemMessage",
    "UserMessage",
    "AssistantMessage",
    "ToolMessage",
    "ToolCall",
    "ToolSpec",
    "create_llm_provider",
]
