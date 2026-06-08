from typing import Any

from fastapi.testclient import TestClient

from helio_intelligence.agent import Copilot, OrgScope, copilot_tool_specs
from helio_intelligence.agent.tools import ToolDispatcher
from helio_intelligence.app import create_app
from helio_intelligence.copilot_api import get_copilot
from helio_intelligence.data.repository import WorkspaceSummary
from helio_intelligence.llm import LLMResponse, ToolCall, UserMessage
from helio_intelligence.llm.fake import FakeProvider

SCOPE = OrgScope(organization_id="org_a", workspace_id="ws_a")


class FakeRepo:
    """A stand-in repository recording the scope it was called with."""

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
        self.calls.append(("segments", org, ws))
        return [{"name": "Pros", "description": "pro plan"}]

    async def list_journeys(self, org: str, ws: str) -> list[dict[str, Any]]:
        return []

    async def list_campaigns(self, org: str, ws: str) -> list[dict[str, Any]]:
        return []

    async def list_email_templates(self, org: str, ws: str) -> list[dict[str, Any]]:
        return []

    async def list_scoring_rules(self, org: str, ws: str) -> list[dict[str, Any]]:
        return []


def test_tool_specs_are_read_only_and_named() -> None:
    names = {spec.name for spec in copilot_tool_specs()}
    assert "get_workspace_summary" in names
    assert "search_contacts" in names
    assert len(names) == 7


async def test_dispatcher_injects_scope_not_model_args() -> None:
    repo = FakeRepo()
    dispatcher = ToolDispatcher(repo, SCOPE)  # type: ignore[arg-type]
    # The model only supplies the query; org/workspace come from the scope.
    result = await dispatcher.dispatch("search_contacts", {"query": "ada", "limit": 5})
    assert "ada@a.com" in result
    assert repo.calls[-1] == ("search", "org_a", "ws_a")


async def test_dispatcher_reports_unknown_and_failing_tools() -> None:
    class Boom(FakeRepo):
        async def list_segments(self, org: str, ws: str) -> list[dict[str, Any]]:
            raise RuntimeError("db gone")

    assert "unknown tool" in await ToolDispatcher(FakeRepo(), SCOPE).dispatch("nope", {})  # type: ignore[arg-type]
    failed = await ToolDispatcher(Boom(), SCOPE).dispatch("list_segments", {})  # type: ignore[arg-type]
    assert "db gone" in failed


async def test_copilot_runs_a_tool_then_answers() -> None:
    repo = FakeRepo()
    provider = FakeProvider(
        [
            # First turn: call a tool.
            LLMResponse(
                tool_calls=(ToolCall(id="c1", name="search_contacts", arguments={"query": "ada"}),)
            ),
            # Second turn: answer with the tool result in context.
            LLMResponse(text="Your top contact is ada@a.com."),
        ]
    )
    copilot = Copilot(provider=provider, repository=repo)  # type: ignore[arg-type]
    reply = await copilot.chat(SCOPE, [UserMessage("who's my best contact?")])

    assert reply.text == "Your top contact is ada@a.com."
    assert reply.tool_calls_made == 1
    assert reply.iterations == 2
    # Grounding snapshot + the search both used the caller's scope only.
    assert all(org == "org_a" and ws == "ws_a" for _, org, ws in repo.calls)
    # The system prompt carried the workspace snapshot.
    system = provider.calls[0]["messages"][0]
    assert "6" in system.content  # contact count from the snapshot


async def test_copilot_answers_without_tools() -> None:
    provider = FakeProvider([LLMResponse(text="Hello! How can I help?")])
    copilot = Copilot(provider=provider, repository=FakeRepo())  # type: ignore[arg-type]
    reply = await copilot.chat(SCOPE, [UserMessage("hi")])
    assert reply.text == "Hello! How can I help?"
    assert reply.tool_calls_made == 0


async def test_copilot_stops_at_the_iteration_budget() -> None:
    # The model keeps asking for tools forever; the loop must terminate.
    looping = [
        LLMResponse(tool_calls=(ToolCall(id=f"c{i}", name="list_journeys", arguments={}),))
        for i in range(3)
    ]
    provider = FakeProvider(looping)
    provider.enqueue(LLMResponse(text="final fallback answer"))  # the tool-free pass
    copilot = Copilot(provider=provider, repository=FakeRepo(), max_iterations=3)  # type: ignore[arg-type]
    reply = await copilot.chat(SCOPE, [UserMessage("loop?")])
    assert reply.text == "final fallback answer"
    assert reply.iterations == 3


def test_chat_endpoint_returns_503_until_configured() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/v1/copilot/chat",
        json={
            "organization_id": "o",
            "workspace_id": "w",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert response.status_code == 503


def test_chat_endpoint_runs_the_copilot_when_overridden() -> None:
    app = create_app()
    provider = FakeProvider([LLMResponse(text="grounded answer")])
    copilot = Copilot(provider=provider, repository=FakeRepo())  # type: ignore[arg-type]
    app.dependency_overrides[get_copilot] = lambda: copilot
    client = TestClient(app)
    response = client.post(
        "/v1/copilot/chat",
        json={
            "organization_id": "org_a",
            "workspace_id": "ws_a",
            "messages": [{"role": "user", "content": "summarize my workspace"}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "grounded answer"
    assert "tool_calls_made" in body


def test_chat_endpoint_validates_input() -> None:
    app = create_app()
    copilot = Copilot(provider=FakeProvider([LLMResponse(text="x")]), repository=FakeRepo())  # type: ignore[arg-type]
    app.dependency_overrides[get_copilot] = lambda: copilot
    client = TestClient(app)
    bad = client.post(
        "/v1/copilot/chat",
        json={"organization_id": "o", "workspace_id": "w", "messages": []},
    )
    assert bad.status_code == 422
