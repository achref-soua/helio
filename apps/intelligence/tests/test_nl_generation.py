import json

import pytest
from fastapi.testclient import TestClient

from helio_intelligence.agent.journey_schema import validate_journey
from helio_intelligence.agent.nl_journey import NlJourneyGenerator
from helio_intelligence.agent.nl_segment import NlSegmentGenerator
from helio_intelligence.agent.segment_schema import validate_segment_rule
from helio_intelligence.app import create_app
from helio_intelligence.generation_api import (
    get_journey_generator,
    get_repository,
    get_segment_generator,
)
from helio_intelligence.llm import LLMResponse
from helio_intelligence.llm.fake import FakeProvider

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
        },
        {
            "kind": "condition",
            "target": "event",
            "event": "Email Opened",
            "operator": "at_least",
            "count": 1,
            "inLastDays": 7,
        },
    ],
}

VALID_JOURNEY = {
    "trigger": {"type": "event", "event": "Signed Up"},
    "startNodeId": "n1",
    "nodes": [
        {"id": "n1", "type": "send_email", "templateId": "tpl_welcome"},
        {"id": "n2", "type": "wait", "seconds": 172800},
        {"id": "n3", "type": "end"},
    ],
    "edges": [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n3"}],
}


def test_segment_schema_accepts_and_bounds() -> None:
    validate_segment_rule(VALID_SEGMENT)
    with pytest.raises(ValueError, match="needs a value"):
        validate_segment_rule(
            {
                "kind": "group",
                "op": "and",
                "children": [
                    {
                        "kind": "condition",
                        "target": "field",
                        "field": "email",
                        "operator": "contains",
                    }
                ],
            }
        )


def test_journey_schema_validates_graph_integrity() -> None:
    validate_journey(VALID_JOURNEY)
    with pytest.raises(ValueError, match="missing node"):
        validate_journey({**VALID_JOURNEY, "startNodeId": "ghost"})
    cyclic = {
        "trigger": {"type": "event", "event": "x"},
        "startNodeId": "a",
        "nodes": [
            {"id": "a", "type": "wait", "seconds": 60},
            {"id": "b", "type": "wait", "seconds": 60},
        ],
        "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}],
    }
    with pytest.raises(ValueError, match="cycle"):
        validate_journey(cyclic)


async def test_nl_segment_generates_and_repairs() -> None:
    # First response is junk; the generator repairs on the second.
    provider = FakeProvider(
        [LLMResponse(text="not json at all"), LLMResponse(text=json.dumps(VALID_SEGMENT))]
    )
    generator = NlSegmentGenerator(provider)
    result = await generator.generate("pro customers who opened an email this week")
    assert result.rule["op"] == "and"
    assert result.name  # a name is suggested
    assert len(provider.calls) == 2  # one repair round


async def test_nl_segment_gives_up_after_repair() -> None:
    provider = FakeProvider([LLMResponse(text="garbage"), LLMResponse(text="still garbage")])
    with pytest.raises(ValueError, match="could not produce"):
        await NlSegmentGenerator(provider).generate("nonsense")


async def test_nl_journey_requires_known_templates() -> None:
    provider = FakeProvider([LLMResponse(text=json.dumps(VALID_JOURNEY))])
    generator = NlJourneyGenerator(provider)
    # Template id in the journey is not in the available set -> rejected.
    with pytest.raises(ValueError):
        await generator.generate("welcome series", [{"id": "tpl_other", "name": "Other"}])


async def test_nl_journey_generates_with_known_template() -> None:
    provider = FakeProvider([LLMResponse(text=json.dumps(VALID_JOURNEY))])
    generator = NlJourneyGenerator(provider)
    result = await generator.generate(
        "welcome then wait", [{"id": "tpl_welcome", "name": "Welcome"}]
    )
    assert result.definition["startNodeId"] == "n1"
    assert result.definition["edges"][0]["from"] == "n1"  # alias preserved


async def test_nl_journey_needs_a_template_to_exist() -> None:
    with pytest.raises(ValueError, match="create one"):
        await NlJourneyGenerator(FakeProvider()).generate("x", [])


class _Repo:
    async def template_options(self, org: str, ws: str) -> list[dict[str, str]]:
        return [{"id": "tpl_welcome", "name": "Welcome"}]


def test_segment_endpoint() -> None:
    app = create_app()
    app.dependency_overrides[get_segment_generator] = lambda: NlSegmentGenerator(
        FakeProvider([LLMResponse(text=json.dumps(VALID_SEGMENT))])
    )
    client = TestClient(app)
    response = client.post(
        "/v1/copilot/segment",
        json={"organization_id": "o", "workspace_id": "w", "prompt": "pro users"},
    )
    assert response.status_code == 200
    assert response.json()["rule"]["op"] == "and"


def test_segment_endpoint_422_on_unmakeable() -> None:
    app = create_app()
    app.dependency_overrides[get_segment_generator] = lambda: NlSegmentGenerator(
        FakeProvider([LLMResponse(text="junk"), LLMResponse(text="junk")])
    )
    client = TestClient(app)
    response = client.post(
        "/v1/copilot/segment",
        json={"organization_id": "o", "workspace_id": "w", "prompt": "??"},
    )
    assert response.status_code == 422


def test_journey_endpoint_uses_org_templates() -> None:
    app = create_app()
    app.dependency_overrides[get_journey_generator] = lambda: NlJourneyGenerator(
        FakeProvider([LLMResponse(text=json.dumps(VALID_JOURNEY))])
    )
    app.dependency_overrides[get_repository] = lambda: _Repo()
    client = TestClient(app)
    response = client.post(
        "/v1/copilot/journey",
        json={"organization_id": "o", "workspace_id": "w", "prompt": "welcome series"},
    )
    assert response.status_code == 200
    assert response.json()["definition"]["startNodeId"] == "n1"


def test_generation_endpoints_503_until_configured() -> None:
    client = TestClient(create_app())
    seg = client.post(
        "/v1/copilot/segment",
        json={"organization_id": "o", "workspace_id": "w", "prompt": "x"},
    )
    assert seg.status_code == 503
