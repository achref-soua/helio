"""Deterministic display names for AI drafts.

The model is never asked to name its drafts: a name derived from the
user's own prompt is predictable, costs no tokens, and cannot be steered
by prompt-injected text inside generated content.
"""

import re

# Words that read as noise when a prompt is cut mid-phrase ("…Pro Plan
# With"). Stripped only from the tail, never from the middle.
_TRAILING_FILLER = {
    "a",
    "an",
    "and",
    "for",
    "in",
    "of",
    "on",
    "or",
    "that",
    "the",
    "then",
    "to",
    "who",
    "whose",
    "with",
}


def suggest_name(prompt: str, fallback: str, *, max_words: int = 6) -> str:
    """A short title-cased name from the first words of the prompt."""
    words = re.findall(r"[A-Za-z0-9]+", prompt)[:max_words]
    while words and words[-1].lower() in _TRAILING_FILLER:
        words.pop()
    name = " ".join(words).strip().title()
    return name[:80] or fallback
