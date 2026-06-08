"""The MCP server definition and its tools.

Built with the official MCP Python SDK (FastMCP). Tools are thin wrappers
over the org-scoped repository and the NL generators, so the MCP surface
inherits the same tenant isolation and validation as the HTTP API.
"""

from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

from ..agent.nl_email import NlEmailGenerator
from ..agent.nl_journey import NlJourneyGenerator
from ..agent.nl_segment import NlSegmentGenerator
from ..data import OrgRepository
from ..llm import LLMProvider


def build_mcp_server(
    *,
    repository: OrgRepository,
    provider: LLMProvider,
    organization_id: str,
    workspace_id: str,
    name: str = "helio",
) -> FastMCP:
    """Assemble an MCP server scoped to one workspace.

    All tools close over ``organization_id``/``workspace_id`` — an
    external agent supplies intent (a query, a prompt), never the tenant.
    """
    mcp = FastMCP(name)
    org, ws = organization_id, workspace_id
    segment_gen = NlSegmentGenerator(provider)
    journey_gen = NlJourneyGenerator(provider)
    email_gen = NlEmailGenerator(provider)

    @mcp.tool()
    async def workspace_summary() -> str:
        """Counts of contacts, active journeys, segments, campaigns,
        email templates, and forms in the connected Helio workspace."""
        summary = await repository.workspace_summary(org, ws)
        return json.dumps(summary.__dict__)

    @mcp.tool()
    async def search_contacts(query: str = "", limit: int = 10) -> str:
        """Find contacts by free text over email and name. Returns up to
        `limit` contacts with their score and status."""
        return json.dumps(await repository.search_contacts(org, ws, query, limit))

    @mcp.tool()
    async def list_segments() -> str:
        """List the workspace's segments with their descriptions."""
        return json.dumps(await repository.list_segments(org, ws))

    @mcp.tool()
    async def list_journeys() -> str:
        """List the workspace's journeys with their status."""
        return json.dumps(await repository.list_journeys(org, ws))

    @mcp.tool()
    async def list_campaigns() -> str:
        """List the workspace's campaigns with their status."""
        return json.dumps(await repository.list_campaigns(org, ws))

    @mcp.tool()
    async def list_email_templates() -> str:
        """List the workspace's email templates with their subjects."""
        return json.dumps(await repository.list_email_templates(org, ws))

    @mcp.tool()
    async def draft_segment(prompt: str) -> str:
        """Draft a segment rule from a natural-language description.
        Returns a name and a validated rule the operator can save."""
        result = await segment_gen.generate(prompt)
        return json.dumps({"name": result.name, "rule": result.rule})

    @mcp.tool()
    async def draft_journey(prompt: str) -> str:
        """Draft a journey from a natural-language description, wiring
        send steps to the workspace's real email templates."""
        templates = await repository.template_options(org, ws)
        result = await journey_gen.generate(prompt, templates)
        return json.dumps({"name": result.name, "definition": result.definition})

    @mcp.tool()
    async def draft_email(prompt: str) -> str:
        """Draft a marketing email (subject + block document) from a
        description, matching the brand voice of the workspace's existing
        emails. Returns a name, subject, and validated document to save."""
        voice = [
            str(t["subject"])
            for t in await repository.list_email_templates(org, ws)
            if t.get("subject")
        ]
        result = await email_gen.generate(prompt, voice)
        return json.dumps(
            {"name": result.name, "subject": result.subject, "document": result.document}
        )

    return mcp


def list_tool_names(server: FastMCP) -> list[str]:
    """The names of the tools a server exposes (sync helper for tests)."""
    import anyio

    async def _names() -> list[str]:
        tools = await server.list_tools()
        return [tool.name for tool in tools]

    return anyio.run(_names)
