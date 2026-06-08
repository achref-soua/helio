"""Best send hour per contact, from engagement history.

Given each contact's open/click counts bucketed by hour-of-day (UTC), pick
the hour they engage most. Contacts with too little history fall back to
the workspace's overall best hour, which itself falls back to a sane
default when the workspace has no engagement yet.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

# A reasonable mid-afternoon default before any engagement exists (UTC).
DEFAULT_HOUR = 14
# Below this many engagement events, a per-contact hour is just noise.
MIN_EVENTS_PER_CONTACT = 3


def best_hours(
    rows: list[dict[str, Any]],
    *,
    min_events: int = MIN_EVENTS_PER_CONTACT,
    default_hour: int = DEFAULT_HOUR,
) -> tuple[dict[str, int], int]:
    """Return (per-email best hour, workspace fallback hour).

    ``rows`` are {email, hour, count} from the event store. Ties break to
    the earlier hour, deterministically.
    """
    per_email: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    totals: dict[int, int] = defaultdict(int)
    for row in rows:
        email = str(row["email"])
        hour = int(row["hour"])
        count = int(row["count"])
        if 0 <= hour <= 23 and count > 0:
            per_email[email][hour] += count
            totals[hour] += count

    fallback = _argmax_hour(totals, default_hour)
    best: dict[str, int] = {}
    for email, histogram in per_email.items():
        if sum(histogram.values()) >= min_events:
            best[email] = _argmax_hour(histogram, fallback)
    return best, fallback


def _argmax_hour(histogram: dict[int, int], default: int) -> int:
    if not histogram:
        return default
    # max count, earliest hour on a tie.
    return min(histogram, key=lambda hour: (-histogram[hour], hour))
