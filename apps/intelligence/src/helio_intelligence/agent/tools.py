"""Copilot tools and their dispatcher.

The model chooses a tool and its arguments; the dispatcher binds the call
to the session's :class:`OrgScope` and runs it through the RLS-scoped
repository. The model can never widen the data it sees — org and
workspace are injected, not accepted from the model.
"""

from __future__ import annotations

import json
from typing import Any

from ..data import OrgRepository
from ..llm import ToolSpec
from .scope import OrgScope

# JSON Schema fragments reused across tools.
_NO_ARGS: dict[str, Any] = {"type": "object", "properties": {}, "additionalProperties": False}


def copilot_tool_specs() -> list[ToolSpec]:
    """The tools the copilot may call. All are read-only and org-scoped."""
    return [
        ToolSpec(
            name="get_workspace_summary",
            description="Counts of contacts, active journeys, segments, campaigns, "
            "email templates, and forms in the current workspace.",
            parameters=_NO_ARGS,
        ),
        ToolSpec(
            name="count_contacts",
            description="Count the workspace's contacts. Pass `key` and `value` "
            "to count only contacts whose attribute equals a value "
            "(e.g. key='plan', value='pro'); omit both for the total.",
            parameters={
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Attribute name to filter by.",
                    },
                    "value": {
                        "type": "string",
                        "description": "Attribute value that must match exactly.",
                    },
                },
                "additionalProperties": False,
            },
        ),
        ToolSpec(
            name="search_contacts",
            description="Find contacts by a free-text query over email and name. "
            "Returns up to `limit` contacts with their score and status.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search text; empty for top contacts.",
                    },
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                },
                "additionalProperties": False,
            },
        ),
        ToolSpec(
            name="list_segments",
            description="List the workspace's segments with their descriptions.",
            parameters=_NO_ARGS,
        ),
        ToolSpec(
            name="list_journeys",
            description="List the workspace's journeys with their status.",
            parameters=_NO_ARGS,
        ),
        ToolSpec(
            name="list_campaigns",
            description="List the workspace's campaigns with their status.",
            parameters=_NO_ARGS,
        ),
        ToolSpec(
            name="list_email_templates",
            description="List the workspace's email templates with their subjects.",
            parameters=_NO_ARGS,
        ),
        ToolSpec(
            name="list_scoring_rules",
            description="List the workspace's lead-scoring rules (event → points).",
            parameters=_NO_ARGS,
        ),
    ]


class ToolDispatcher:
    """Executes a model's tool call against the scoped repository."""

    def __init__(self, repository: OrgRepository, scope: OrgScope) -> None:
        self._repo = repository
        self._scope = scope

    async def dispatch(self, name: str, arguments: dict[str, Any]) -> str:
        """Run ``name`` and return a JSON string for the model."""
        org, ws = self._scope.organization_id, self._scope.workspace_id
        try:
            if name == "get_workspace_summary":
                summary = await self._repo.workspace_summary(org, ws)
                return json.dumps(summary.__dict__)
            if name == "count_contacts":
                key = str(arguments.get("key", "")).strip()
                value = str(arguments.get("value", "")).strip()
                count = (
                    await self._repo.count_contacts_by_attribute(org, ws, key, value)
                    if key and value
                    else await self._repo.count_contacts(org, ws)
                )
                applied = {"key": key, "value": value} if key and value else None
                return json.dumps({"count": count, "filter": applied})
            if name == "search_contacts":
                query = str(arguments.get("query", ""))
                limit = int(arguments.get("limit", 10))
                return json.dumps(await self._repo.search_contacts(org, ws, query, limit))
            if name == "list_segments":
                return json.dumps(await self._repo.list_segments(org, ws))
            if name == "list_journeys":
                return json.dumps(await self._repo.list_journeys(org, ws))
            if name == "list_campaigns":
                return json.dumps(await self._repo.list_campaigns(org, ws))
            if name == "list_email_templates":
                return json.dumps(await self._repo.list_email_templates(org, ws))
            if name == "list_scoring_rules":
                return json.dumps(await self._repo.list_scoring_rules(org, ws))
        except Exception as error:  # noqa: BLE001 — surfaced to the model, not raised
            return json.dumps({"error": f"tool '{name}' failed: {error}"})
        return json.dumps({"error": f"unknown tool '{name}'"})
