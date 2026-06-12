"""Natural language → journey definition.

"Send a welcome email, wait two days, then upsell pro users" becomes a
validated journey the TypeScript API accepts. The model must reference
real template ids, so the available templates are supplied in the prompt.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from ..llm import LLMProvider, SystemMessage, UserMessage
from .journey_schema import validate_journey
from .naming import suggest_name

_SYSTEM_PROMPT = """You convert a marketer's request into a Helio journey \
definition as JSON. Output ONLY the JSON object — no prose, no code fences.

Shape:
  {"trigger":{"type":"event","event":"Signed Up"},
   "startNodeId":"n1",
   "nodes":[
     {"id":"n1","type":"send_email","templateId":"<id>"},
     {"id":"n2","type":"wait","seconds":<10..7776000>},
     {"id":"n3","type":"branch","condition":<segment condition>},
     {"id":"n4","type":"end"}],
   "edges":[{"from":"n1","to":"n2"},{"from":"n3","to":"n4","label":"yes"}]}

Rules:
- Every send_email.templateId MUST be one of the AVAILABLE TEMPLATES below.
- A branch needs exactly two outgoing edges labelled "yes" and "no"; other
  nodes have at most one outgoing edge; end nodes have none.
- The graph must be acyclic and reach an end node. startNodeId is the first node.
- A branch condition uses the segment-condition shape, e.g.
  {"kind":"condition","target":"attribute","key":"plan","operator":"equals","value":"pro"}."""

_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


@dataclass(frozen=True)
class GeneratedJourney:
    definition: dict[str, Any]
    name: str


def _extract_json(text: str) -> dict[str, Any]:
    match = _JSON_BLOCK.search(text)
    if not match:
        raise ValueError("the model did not return JSON")
    return json.loads(match.group(0))  # type: ignore[no-any-return]


class NlJourneyGenerator:
    def __init__(self, provider: LLMProvider, *, temperature: float = 0.0) -> None:
        self._provider = provider
        self._temperature = temperature

    async def generate(self, prompt: str, templates: list[dict[str, str]]) -> GeneratedJourney:
        """Return a validated journey, or raise ValueError if it can't be made."""
        if not templates:
            raise ValueError("no email templates exist yet — create one before a journey")
        catalogue = "\n".join(f"- {t['id']}: {t['name']}" for t in templates)
        valid_ids = {t["id"] for t in templates}

        messages: list[Any] = [
            SystemMessage(_SYSTEM_PROMPT),
            UserMessage(
                f"AVAILABLE TEMPLATES:\n{catalogue}\n\n"
                f"Request: {prompt.strip()}\nReturn the journey JSON."
            ),
        ]
        last_error = ""
        for _attempt in range(3):
            response = await self._provider.complete(
                messages, temperature=self._temperature, max_tokens=1200
            )
            try:
                data = _extract_json(response.text)
                journey = validate_journey(data)
                _assert_known_templates(journey, valid_ids)
                # exclude_none: optional fields the model left null (edge
                # labels) must be absent — the zod schema rejects nulls.
                return GeneratedJourney(
                    definition=journey.model_dump(by_alias=True, exclude_none=True),
                    name=suggest_name(prompt, "New journey"),
                )
            except (ValueError, json.JSONDecodeError) as error:
                last_error = str(error)
                messages.append(UserMessage(response.text))
                messages.append(
                    UserMessage(
                        f"That was invalid: {last_error}. Return corrected journey JSON only."
                    )
                )
        raise ValueError(f"could not produce a valid journey: {last_error}")


def _assert_known_templates(journey: Any, valid_ids: set[str]) -> None:
    for node in journey.nodes:
        if node.type == "send_email" and node.templateId not in valid_ids:
            raise ValueError(f"templateId '{node.templateId}' is not an available template")
