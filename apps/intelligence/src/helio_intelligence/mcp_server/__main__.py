"""Run the Helio MCP server over stdio.

    INTEL_LLM_API_KEY=... INTEL_DATABASE_URL=... \
    INTEL_MCP_ORGANIZATION_ID=org_... INTEL_MCP_WORKSPACE_ID=ws_... \
    uv run python -m helio_intelligence.mcp_server

The server exposes Helio's capabilities as MCP tools, scoped to the one
configured workspace.
"""

from __future__ import annotations

import sys

from ..data import Database, OrgRepository
from ..llm import create_llm_provider
from ..settings import get_settings
from .server import build_mcp_server


def main() -> None:
    settings = get_settings()
    missing = [
        name
        for name, value in (
            ("INTEL_LLM_API_KEY (or a local provider)", settings.llm_configured),
            ("INTEL_DATABASE_URL", settings.database_url),
            ("INTEL_MCP_ORGANIZATION_ID", settings.mcp_organization_id),
            ("INTEL_MCP_WORKSPACE_ID", settings.mcp_workspace_id),
        )
        if not value
    ]
    if missing:
        sys.stderr.write("MCP server cannot start; missing: " + ", ".join(missing) + "\n")
        raise SystemExit(2)

    repository = OrgRepository(Database(settings.database_url))
    provider = create_llm_provider(settings)
    server = build_mcp_server(
        repository=repository,
        provider=provider,
        organization_id=settings.mcp_organization_id,
        workspace_id=settings.mcp_workspace_id,
    )
    server.run()


if __name__ == "__main__":
    main()
