"""Helio's MCP server: exposes the platform's capabilities as tools so
external AI agents (and the operator's own assistant) can drive Helio
programmatically — read the workspace, draft segments, draft journeys.

The server is scoped to one workspace via configuration; every tool runs
through the same RLS-bound data layer, so an agent can only ever touch
that organization's data.
"""

from .server import build_mcp_server

__all__ = ["build_mcp_server"]
