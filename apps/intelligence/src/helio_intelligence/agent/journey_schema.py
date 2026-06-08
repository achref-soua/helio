"""A Pydantic mirror of @helio/core's journey definition schema.

In lock-step with packages/core/src/journeys.ts so a generated journey is
accepted verbatim by the TypeScript journey API.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

from .segment_schema import Condition


class Trigger(BaseModel):
    type: Literal["event"] = "event"
    event: str = Field(min_length=1, max_length=200)


class SendEmailNode(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["send_email"] = "send_email"
    templateId: str = Field(min_length=1)


class WaitNode(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["wait"] = "wait"
    seconds: int = Field(ge=10, le=90 * 24 * 60 * 60)


class BranchNode(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["branch"] = "branch"
    condition: Condition


class EndNode(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["end"] = "end"


JourneyNode = Annotated[
    Union[SendEmailNode, WaitNode, BranchNode, EndNode],  # noqa: UP007
    Field(discriminator="type"),
]


class JourneyEdge(BaseModel):
    from_: str = Field(alias="from", min_length=1, max_length=64)
    to: str = Field(min_length=1, max_length=64)
    label: Literal["yes", "no"] | None = None

    model_config = {"populate_by_name": True}


class JourneyDefinition(BaseModel):
    trigger: Trigger
    startNodeId: str = Field(min_length=1, max_length=64)
    nodes: list[JourneyNode] = Field(min_length=1, max_length=50)
    edges: list[JourneyEdge] = Field(max_length=100)

    model_config = {"populate_by_name": True}


def validate_journey(data: dict[str, Any]) -> JourneyDefinition:
    """Parse and integrity-check a journey definition."""
    journey = JourneyDefinition.model_validate(data)
    ids = {node.id for node in journey.nodes}
    if len(ids) != len(journey.nodes):
        raise ValueError("duplicate node ids")
    if journey.startNodeId not in ids:
        raise ValueError("startNodeId references a missing node")
    outgoing: dict[str, list[JourneyEdge]] = {}
    for edge in journey.edges:
        if edge.from_ not in ids or edge.to not in ids:
            raise ValueError(f"edge {edge.from_}->{edge.to} references a missing node")
        outgoing.setdefault(edge.from_, []).append(edge)
    by_type = {node.id: node.type for node in journey.nodes}
    for node in journey.nodes:
        edges = outgoing.get(node.id, [])
        if node.type == "branch":
            labels = {edge.label for edge in edges}
            if len(edges) != 2 or labels != {"yes", "no"}:
                raise ValueError(f"branch '{node.id}' needs one yes and one no edge")
        elif node.type == "end":
            if edges:
                raise ValueError(f"end '{node.id}' cannot have outgoing edges")
        elif len(edges) > 1:
            raise ValueError(f"{by_type[node.id]} '{node.id}' allows at most one outgoing edge")
    _assert_acyclic(journey.startNodeId, outgoing)
    return journey


def _assert_acyclic(start: str, outgoing: dict[str, list[JourneyEdge]]) -> None:
    colors: dict[str, str] = {}

    def visit(node_id: str) -> None:
        state = colors.get(node_id)
        if state == "visiting":
            raise ValueError("the journey graph must not contain cycles")
        if state == "done":
            return
        colors[node_id] = "visiting"
        for edge in outgoing.get(node_id, []):
            visit(edge.to)
        colors[node_id] = "done"

    visit(start)
