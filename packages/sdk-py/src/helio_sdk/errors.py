"""Errors raised by the Helio SDK."""

from __future__ import annotations


class HelioApiError(Exception):
    """Raised on any non-2xx gateway response; carries the RFC 9457 problem.

    Attributes mirror the ``application/problem+json`` body: ``status`` (HTTP
    status code), ``type`` (a stable URN), ``title``, and an optional
    ``detail``.
    """

    def __init__(self, *, status: int, type: str, title: str, detail: str | None = None) -> None:
        super().__init__(f"{title}: {detail}" if detail else title)
        self.status = status
        self.type = type
        self.title = title
        self.detail = detail
