"""Read-only domain queries, always run through a scoped connection.

Each method opens a connection pinned to one organization (RLS via
``app.org_id``), so results always belong to that tenant. Queries also
filter by workspace where the caller provides one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .db import Database


@dataclass(frozen=True)
class WorkspaceSummary:
    contacts: int
    active_journeys: int
    segments: int
    campaigns: int
    email_templates: int
    forms: int


class OrgRepository:
    """Organization-scoped reads for the copilot's tools and RAG."""

    def __init__(self, database: Database) -> None:
        self._db = database

    async def count_contacts(self, organization_id: str, workspace_id: str) -> int:
        async with self._db.scoped(organization_id) as scoped:
            value = await scoped.fetchval(
                "SELECT count(*) FROM contact WHERE workspace_id = $1", workspace_id
            )
            return int(value or 0)

    async def search_contacts(
        self, organization_id: str, workspace_id: str, query: str, limit: int = 10
    ) -> list[dict[str, Any]]:
        like = f"%{query.strip()}%"
        async with self._db.scoped(organization_id) as scoped:
            rows = await scoped.fetch(
                """
                SELECT email, first_name, last_name, score, status
                FROM contact
                WHERE workspace_id = $1
                  AND ($2 = '%%' OR email ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2)
                ORDER BY score DESC, created_at DESC
                LIMIT $3
                """,
                workspace_id,
                like,
                max(1, min(limit, 50)),
            )
            return [dict(row) for row in rows]

    async def list_segments(self, organization_id: str, workspace_id: str) -> list[dict[str, Any]]:
        async with self._db.scoped(organization_id) as scoped:
            rows = await scoped.fetch(
                "SELECT name, description FROM segment WHERE workspace_id = $1 ORDER BY created_at",
                workspace_id,
            )
            return [dict(row) for row in rows]

    async def list_journeys(self, organization_id: str, workspace_id: str) -> list[dict[str, Any]]:
        async with self._db.scoped(organization_id) as scoped:
            rows = await scoped.fetch(
                "SELECT name, status FROM journey WHERE workspace_id = $1 ORDER BY created_at",
                workspace_id,
            )
            return [dict(row) for row in rows]

    async def list_campaigns(self, organization_id: str, workspace_id: str) -> list[dict[str, Any]]:
        async with self._db.scoped(organization_id) as scoped:
            rows = await scoped.fetch(
                "SELECT name, status FROM campaign"
                " WHERE workspace_id = $1 ORDER BY created_at DESC",
                workspace_id,
            )
            return [dict(row) for row in rows]

    async def list_email_templates(
        self, organization_id: str, workspace_id: str
    ) -> list[dict[str, Any]]:
        async with self._db.scoped(organization_id) as scoped:
            rows = await scoped.fetch(
                "SELECT name, subject FROM email_template"
                " WHERE workspace_id = $1 ORDER BY created_at",
                workspace_id,
            )
            return [dict(row) for row in rows]

    async def list_scoring_rules(
        self, organization_id: str, workspace_id: str
    ) -> list[dict[str, Any]]:
        async with self._db.scoped(organization_id) as scoped:
            rows = await scoped.fetch(
                "SELECT event, points FROM scoring_rule"
                " WHERE workspace_id = $1 ORDER BY created_at",
                workspace_id,
            )
            return [dict(row) for row in rows]

    async def workspace_summary(self, organization_id: str, workspace_id: str) -> WorkspaceSummary:
        async with self._db.scoped(organization_id) as scoped:
            row = await scoped.fetchrow(
                """
                SELECT
                  (SELECT count(*) FROM contact WHERE workspace_id = $1) AS contacts,
                  (SELECT count(*) FROM journey
                     WHERE workspace_id = $1 AND status = 'ACTIVE') AS active_journeys,
                  (SELECT count(*) FROM segment WHERE workspace_id = $1) AS segments,
                  (SELECT count(*) FROM campaign WHERE workspace_id = $1) AS campaigns,
                  (SELECT count(*) FROM email_template WHERE workspace_id = $1) AS email_templates,
                  (SELECT count(*) FROM form WHERE workspace_id = $1) AS forms
                """,
                workspace_id,
            )
            assert row is not None
            return WorkspaceSummary(
                contacts=int(row["contacts"]),
                active_journeys=int(row["active_journeys"]),
                segments=int(row["segments"]),
                campaigns=int(row["campaigns"]),
                email_templates=int(row["email_templates"]),
                forms=int(row["forms"]),
            )
