"""The agentic copilot: a bounded tool-calling loop.

Each turn the model may either answer or request tools; the dispatcher
runs them against the caller's own data and feeds results back until the
model answers or the iteration budget is spent. The session is grounded
(RAG) with a workspace summary so even the first turn knows the shape of
the org's data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from ..data import OrgRepository
from ..llm import (
    AssistantMessage,
    LLMProvider,
    Message,
    SystemMessage,
    ToolMessage,
    ToolSpec,
    UserMessage,
)
from .scope import OrgScope
from .tools import ToolDispatcher, copilot_tool_specs

_MAX_ITERATIONS = 6

_SYSTEM_PROMPT = """You are Helio Copilot, an expert marketing-automation assistant \
embedded in the Helio platform. You help the user understand and grow their \
audience inside their current workspace.

Rules:
- You can only see THIS organization's data. Never claim to access anything else.
- Use the provided tools to ground every factual answer in real data — do not \
invent numbers, names, or statuses.
- Be concise and concrete. Prefer specifics (counts, names) over generalities.
- When you lack data to answer, say so and suggest what the user could create.

Workspace snapshot (for grounding):
{snapshot}"""


@dataclass(frozen=True)
class CopilotReply:
    text: str
    tool_calls_made: int = 0
    iterations: int = 1


@dataclass
class Copilot:
    """A tool-using assistant scoped to one organization."""

    provider: LLMProvider
    repository: OrgRepository
    temperature: float = 0.2
    max_tokens: int = 1024
    max_iterations: int = _MAX_ITERATIONS
    _specs: list[ToolSpec] = field(default_factory=copilot_tool_specs)

    async def _snapshot(self, scope: OrgScope) -> str:
        try:
            summary = await self.repository.workspace_summary(
                scope.organization_id, scope.workspace_id
            )
            return json.dumps(summary.__dict__)
        except Exception:  # noqa: BLE001 — grounding is best-effort
            return "{}"

    async def chat(self, scope: OrgScope, history: list[Message]) -> CopilotReply:
        """Run the agent loop over ``history`` and return the final answer."""
        dispatcher = ToolDispatcher(self.repository, scope)
        snapshot = await self._snapshot(scope)
        messages: list[Message] = [
            SystemMessage(_SYSTEM_PROMPT.format(snapshot=snapshot)),
            *history,
        ]

        tool_calls_made = 0
        for iteration in range(1, self.max_iterations + 1):
            response = await self.provider.complete(
                messages,
                tools=self._specs,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            if not response.wants_tools:
                return CopilotReply(
                    text=response.text or "I don't have an answer for that.",
                    tool_calls_made=tool_calls_made,
                    iterations=iteration,
                )

            messages.append(AssistantMessage(content=response.text, tool_calls=response.tool_calls))
            for call in response.tool_calls:
                tool_calls_made += 1
                result = await dispatcher.dispatch(call.name, call.arguments)
                messages.append(ToolMessage(tool_call_id=call.id, content=result))

        # Budget spent — make one final, tool-free pass for a best answer.
        final = await self.provider.complete(
            [*messages, UserMessage("Answer now using what you have; do not call more tools.")],
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        return CopilotReply(
            text=final.text or "I wasn't able to complete that in time.",
            tool_calls_made=tool_calls_made,
            iterations=self.max_iterations,
        )
