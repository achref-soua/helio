import json
from typing import Any

from helio_intelligence.data.repository import WorkspaceSummary
from helio_intelligence.llm import LLMResponse
from helio_intelligence.llm.fake import FakeProvider
from helio_intelligence.mcp_server import build_mcp_server
from helio_intelligence.mcp_server.server import list_tool_names

VALID_SEGMENT = {
    "kind": "group",
    "op": "and",
    "children": [
        {
            "kind": "condition",
            "target": "attribute",
            "key": "plan",
            "operator": "equals",
            "value": "pro",
        }
    ],
}


class FakeRepo:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    async def workspace_summary(self, org: str, ws: str) -> WorkspaceSummary:
        self.calls.append(("summary", org, ws))
        return WorkspaceSummary(
            contacts=6, active_journeys=1, segments=2, campaigns=1, email_templates=3, forms=1
        )

    async def search_contacts(
        self, org: str, ws: str, query: str, limit: int = 10
    ) -> list[dict[str, Any]]:
        self.calls.append(("search", org, ws))
        return [{"email": "ada@a.com", "score": 80}]

    async def list_segments(self, org: str, ws: str) -> list[dict[str, Any]]:
        return [{"name": "Pros"}]

    async def list_journeys(self, org: str, ws: str) -> list[dict[str, Any]]:
        return []

    async def list_campaigns(self, org: str, ws: str) -> list[dict[str, Any]]:
        return []

    async def list_email_templates(self, org: str, ws: str) -> list[dict[str, Any]]:
        return [{"name": "Welcome", "subject": "Hi"}]

    async def template_options(self, org: str, ws: str) -> list[dict[str, str]]:
        return [{"id": "tpl_welcome", "name": "Welcome"}]


def _server(provider: FakeProvider | None = None) -> tuple[Any, FakeRepo]:
    repo = FakeRepo()
    server = build_mcp_server(
        repository=repo,  # type: ignore[arg-type]
        provider=provider or FakeProvider(),
        organization_id="org_a",
        workspace_id="ws_a",
    )
    return server, repo


def test_server_exposes_the_expected_tools() -> None:
    server, _ = _server()
    names = set(list_tool_names(server))
    assert names == {
        "workspace_summary",
        "search_contacts",
        "list_segments",
        "list_journeys",
        "list_campaigns",
        "list_email_templates",
        "draft_segment",
        "draft_journey",
    }


async def test_tools_run_scoped_to_the_configured_workspace() -> None:
    server, repo = _server()
    result = await server.call_tool("workspace_summary", {})
    payload = _content_text(result)
    assert json.loads(payload)["contacts"] == 6
    assert repo.calls[-1] == ("summary", "org_a", "ws_a")

    await server.call_tool("search_contacts", {"query": "ada", "limit": 5})
    assert repo.calls[-1] == ("search", "org_a", "ws_a")


async def test_draft_segment_tool_generates_a_rule() -> None:
    provider = FakeProvider([LLMResponse(text=json.dumps(VALID_SEGMENT))])
    server, _ = _server(provider)
    result = await server.call_tool("draft_segment", {"prompt": "pro users"})
    body = json.loads(_content_text(result))
    assert body["rule"]["op"] == "and"
    assert body["name"]


async def test_draft_journey_tool_uses_real_templates() -> None:
    journey = {
        "trigger": {"type": "event", "event": "Signed Up"},
        "startNodeId": "n1",
        "nodes": [
            {"id": "n1", "type": "send_email", "templateId": "tpl_welcome"},
            {"id": "n2", "type": "end"},
        ],
        "edges": [{"from": "n1", "to": "n2"}],
    }
    provider = FakeProvider([LLMResponse(text=json.dumps(journey))])
    server, _ = _server(provider)
    result = await server.call_tool("draft_journey", {"prompt": "welcome series"})
    body = json.loads(_content_text(result))
    assert body["definition"]["startNodeId"] == "n1"


def _content_text(result: Any) -> str:
    # FastMCP returns (content_list, ...) or a content list across versions.
    content = result[0] if isinstance(result, tuple) else result
    first = content[0]
    return first.text if hasattr(first, "text") else str(first)
