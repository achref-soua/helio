"""The agentic AI copilot: a tool-calling loop grounded in the caller's
own organization data (RAG), running on the provider-agnostic gateway."""

from .copilot import Copilot, CopilotReply
from .scope import OrgScope
from .tools import ToolDispatcher, copilot_tool_specs

__all__ = ["Copilot", "CopilotReply", "OrgScope", "ToolDispatcher", "copilot_tool_specs"]
