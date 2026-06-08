"""A Pydantic mirror of @helio/core's segment rule schema.

Kept deliberately in lock-step with packages/core/src/segments.ts so a
rule generated here is accepted verbatim by the TypeScript segment API.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, model_validator

STRING_OPERATORS = (
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_set",
    "is_not_set",
)
CONTACT_FIELDS = ("email", "firstName", "lastName")
CONTACT_STATUSES = ("ACTIVE", "UNSUBSCRIBED", "BOUNCED", "COMPLAINED")
_VALUELESS = {"is_set", "is_not_set"}


class FieldCondition(BaseModel):
    kind: Literal["condition"] = "condition"
    target: Literal["field"] = "field"
    field: Literal["email", "firstName", "lastName"]
    operator: Literal[STRING_OPERATORS]  # type: ignore[valid-type]
    value: str | None = None

    @model_validator(mode="after")
    def _check_value(self) -> FieldCondition:
        if self.operator not in _VALUELESS and not self.value:
            raise ValueError(f"operator '{self.operator}' needs a value")
        return self


class AttributeCondition(BaseModel):
    kind: Literal["condition"] = "condition"
    target: Literal["attribute"] = "attribute"
    key: str = Field(min_length=1, max_length=100)
    operator: Literal[STRING_OPERATORS]  # type: ignore[valid-type]
    value: str | None = None

    @model_validator(mode="after")
    def _check_value(self) -> AttributeCondition:
        if self.operator not in _VALUELESS and not self.value:
            raise ValueError(f"operator '{self.operator}' needs a value")
        return self


class StatusCondition(BaseModel):
    kind: Literal["condition"] = "condition"
    target: Literal["status"] = "status"
    operator: Literal["equals", "not_equals"]
    value: Literal[CONTACT_STATUSES]  # type: ignore[valid-type]


class CreatedAtCondition(BaseModel):
    kind: Literal["condition"] = "condition"
    target: Literal["created_at"] = "created_at"
    operator: Literal["before", "after", "in_last_days"]
    value: Union[str, int]  # noqa: UP007 — iso datetime or day count


class EventCondition(BaseModel):
    kind: Literal["condition"] = "condition"
    target: Literal["event"] = "event"
    event: str = Field(min_length=1, max_length=200)
    operator: Literal["at_least", "at_most", "never"]
    count: int = Field(default=1, ge=1, le=10000)
    inLastDays: int = Field(ge=1, le=365)


class ScoreCondition(BaseModel):
    kind: Literal["condition"] = "condition"
    target: Literal["score"] = "score"
    operator: Literal["gte", "lte", "equals"]
    value: int = Field(ge=-100000, le=100000)


class PredictionCondition(BaseModel):
    kind: Literal["condition"] = "condition"
    target: Literal["prediction"] = "prediction"
    metric: Literal["conversionProbability", "churnRisk"]
    operator: Literal["gte", "lte"]
    value: float = Field(ge=0.0, le=1.0)


Condition = Annotated[
    Union[  # noqa: UP007
        FieldCondition,
        AttributeCondition,
        StatusCondition,
        CreatedAtCondition,
        EventCondition,
        ScoreCondition,
        PredictionCondition,
    ],
    Field(discriminator="target"),
]


class RuleGroup(BaseModel):
    kind: Literal["group"] = "group"
    op: Literal["and", "or"]
    children: list[Union[RuleGroup, Condition]] = Field(  # noqa: UP007
        min_length=1, max_length=20
    )


RuleGroup.model_rebuild()


def _depth(node: Any) -> int:
    if getattr(node, "kind", None) != "group":
        return 0
    return 1 + max((_depth(child) for child in node.children), default=0)


def _count(node: Any) -> int:
    if getattr(node, "kind", None) != "group":
        return 1
    return sum(_count(child) for child in node.children)


def validate_segment_rule(data: dict[str, Any]) -> RuleGroup:
    """Parse and bound-check a rule; raises ValueError on anything off."""
    rule = RuleGroup.model_validate(data)
    if _depth(rule) > 5:
        raise ValueError("rule groups nest at most 5 levels")
    if _count(rule) > 50:
        raise ValueError("a segment holds at most 50 conditions")
    return rule
