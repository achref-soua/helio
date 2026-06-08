"""Typed shapes for the public API, mirroring the gateway's OpenAPI schemas.

These are ``TypedDict``s: the client returns the parsed JSON directly (keys
match the wire format, hence camelCase), typed for editor/mypy support without
a runtime model layer.
"""

from __future__ import annotations

from typing import Literal, TypedDict

ContactStatus = Literal["ACTIVE", "UNSUBSCRIBED", "BOUNCED", "COMPLAINED"]


class Workspace(TypedDict):
    id: str
    organizationId: str
    name: str
    slug: str
    createdAt: str


class Contact(TypedDict):
    id: str
    organizationId: str
    workspaceId: str
    email: str
    firstName: str | None
    lastName: str | None
    attributes: dict[str, object]
    status: ContactStatus
    score: int
    conversionProbability: float | None
    churnRisk: float | None
    bestSendHour: int | None
    source: str | None
    createdAt: str
    updatedAt: str


class ContactList(TypedDict):
    id: str
    organizationId: str
    workspaceId: str
    name: str
    memberCount: int
    createdAt: str


class ContactPage(TypedDict):
    """One page of contacts; pass ``nextCursor`` as ``cursor`` for the next."""

    data: list[Contact]
    nextCursor: str | None


class ListPage(TypedDict):
    data: list[ContactList]
    nextCursor: str | None


class AddMembersResult(TypedDict):
    added: int
