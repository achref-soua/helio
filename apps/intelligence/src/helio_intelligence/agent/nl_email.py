"""Natural language → email template, in the workspace's brand voice.

The operator describes the email's goal; the generator drafts a subject
and a block document, grounded (RAG) in the subjects of the workspace's
existing templates so the tone matches what they already send.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from ..llm import LLMProvider, SystemMessage, UserMessage
from .email_schema import validate_email_document
from .naming import suggest_name

_SYSTEM_PROMPT = """You write a Helio marketing email as JSON. Output ONLY the \
JSON object — no prose, no code fences.

Shape:
  {"subject":"...","document":{"blocks":[ ...blocks ]}}

A block is one of (by "type"):
  heading:   {"id":"b1","type":"heading","text":"..."}
  paragraph: {"id":"b2","type":"paragraph","text":"..."}
  button:    {"id":"b3","type":"button","label":"Shop now","url":"https://..."}
  image:     {"id":"b4","type":"image","url":"https://...","alt":"..."}
  divider:   {"id":"b5","type":"divider"}
  spacer:    {"id":"b6","type":"spacer"}

Rules:
- Personalize naturally with {{firstName|there}} where it fits.
- Keep it tight: a heading, one or two short paragraphs, one clear call-to-action button.
- Match the BRAND VOICE shown by the existing subjects below; do not copy them verbatim.
- Every block needs a unique "id". Button/image urls must be absolute https URLs."""

_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


@dataclass(frozen=True)
class GeneratedEmail:
    name: str
    subject: str
    document: dict[str, Any]


def _extract_json(text: str) -> dict[str, Any]:
    match = _JSON_BLOCK.search(text)
    if not match:
        raise ValueError("the model did not return JSON")
    return json.loads(match.group(0))  # type: ignore[no-any-return]


class NlEmailGenerator:
    def __init__(self, provider: LLMProvider, *, temperature: float = 0.4) -> None:
        # A little warmth helps copy; structure is still validated.
        self._provider = provider
        self._temperature = temperature

    async def generate(self, prompt: str, voice_subjects: list[str]) -> GeneratedEmail:
        """Draft a validated email, or raise ValueError if it can't be made."""
        voice = (
            "\n".join(f"- {subject}" for subject in voice_subjects[:10])
            if voice_subjects
            else "(no existing emails yet — use a warm, concise, modern tone)"
        )
        messages: list[Any] = [
            SystemMessage(_SYSTEM_PROMPT),
            UserMessage(
                f"BRAND VOICE (existing subjects):\n{voice}\n\n"
                f"Write an email for: {prompt.strip()}\nReturn the email JSON."
            ),
        ]
        last_error = ""
        for _attempt in range(3):
            response = await self._provider.complete(
                messages, temperature=self._temperature, max_tokens=1200
            )
            try:
                data = _extract_json(response.text)
                subject = str(data.get("subject", "")).strip()
                if not subject:
                    raise ValueError("missing subject")
                document = validate_email_document(data.get("document", {}))
                return GeneratedEmail(
                    name=suggest_name(prompt, "New email"),
                    subject=subject[:300],
                    document=document.model_dump(mode="json", exclude_none=True),
                )
            except (ValueError, json.JSONDecodeError) as error:
                last_error = str(error)
                messages.append(UserMessage(response.text))
                messages.append(
                    UserMessage(
                        f"That was invalid: {last_error}. Return corrected email JSON only."
                    )
                )
        raise ValueError(f"could not produce a valid email: {last_error}")
