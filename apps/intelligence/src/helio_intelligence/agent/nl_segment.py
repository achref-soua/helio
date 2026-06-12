"""Natural language → segment rule.

Turns a sentence ("pro customers who opened an email in the last week")
into a validated segment rule that the TypeScript segment API accepts
verbatim. The model emits JSON; we validate against the schema mirror and
give it one chance to repair a malformed rule before giving up.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from ..llm import LLMProvider, SystemMessage, UserMessage
from .naming import suggest_name
from .segment_schema import validate_segment_rule

_SYSTEM_PROMPT = """You convert a marketer's request into a Helio segment rule \
expressed as JSON. Output ONLY the JSON object — no prose, no code fences.

The rule is a group:
  {"kind":"group","op":"and"|"or","children":[ ...conditions or nested groups ]}

A condition is one of (by "target"):
  field:      {"kind":"condition","target":"field","field":"email"|"firstName"|"lastName",
               "operator":"equals"|"not_equals"|"contains"|"not_contains"|"starts_with"|
               "ends_with"|"is_set"|"is_not_set","value":"..."}  (omit value for is_set/is_not_set)
  attribute:  {"kind":"condition","target":"attribute","key":"plan",
               "operator":<string op>,"value":"pro"}
  status:     {"kind":"condition","target":"status","operator":"equals"|"not_equals",
               "value":"ACTIVE"|"UNSUBSCRIBED"|"BOUNCED"|"COMPLAINED"}
  created_at: {"kind":"condition","target":"created_at","operator":"before"|"after"|"in_last_days",
               "value":<iso-datetime for before/after, or integer days for in_last_days>}
  event:      {"kind":"condition","target":"event","event":"Email Opened","operator":"at_least"|
               "at_most"|"never","count":<int>,"inLastDays":<int>}
  score:      {"kind":"condition","target":"score","operator":"gte"|"lte"|"equals","value":<int>}

Rules: at most 5 levels of nesting and 50 conditions. Choose "and" vs "or" to match \
the request's intent. Use behavioral (event) conditions for actions like opens/clicks."""

_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


@dataclass(frozen=True)
class GeneratedSegment:
    rule: dict[str, Any]
    name: str


def _extract_json(text: str) -> dict[str, Any]:
    match = _JSON_BLOCK.search(text)
    if not match:
        raise ValueError("the model did not return JSON")
    return json.loads(match.group(0))  # type: ignore[no-any-return]


class NlSegmentGenerator:
    def __init__(self, provider: LLMProvider, *, temperature: float = 0.0) -> None:
        self._provider = provider
        self._temperature = temperature

    async def generate(self, prompt: str) -> GeneratedSegment:
        """Return a validated rule, or raise ValueError if it can't be made."""
        messages: list[Any] = [
            SystemMessage(_SYSTEM_PROMPT),
            UserMessage(f"Request: {prompt.strip()}\nReturn the segment rule JSON."),
        ]
        last_error = ""
        for _attempt in range(3):
            response = await self._provider.complete(
                messages, temperature=self._temperature, max_tokens=900
            )
            try:
                data = _extract_json(response.text)
                rule = validate_segment_rule(data)
                return GeneratedSegment(
                    rule=rule.model_dump(exclude_none=True),
                    name=suggest_name(prompt, "New segment"),
                )
            except (ValueError, json.JSONDecodeError) as error:
                last_error = str(error)
                # Feed the error back once for a self-repair attempt.
                messages.append(UserMessage(response.text))
                messages.append(
                    UserMessage(
                        f"That was invalid: {last_error}. Return corrected segment rule JSON only."
                    )
                )
        raise ValueError(f"could not produce a valid segment rule: {last_error}")
