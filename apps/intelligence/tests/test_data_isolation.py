"""Tenant-isolation proof for the copilot's data layer.

Spins up a real Postgres, applies the production migrations (which create
the RLS policies and the helio_app role), seeds two organizations, and
asserts the scoped repository can never read across the tenant boundary —
even when handed another org's workspace id.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast

import asyncpg
import pytest
import pytest_asyncio
from testcontainers.postgres import PostgresContainer

from helio_intelligence.data import Database, OrgRepository

_REPO_ROOT = Path(__file__).resolve().parents[3]

# Share one event loop across the module so the pooled fixture and the
# tests run on the same loop (pytest-asyncio defaults to per-function).
pytestmark = pytest.mark.asyncio(loop_scope="module")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def seeded() -> AsyncIterator[dict[str, Any]]:
    with PostgresContainer("pgvector/pgvector:pg16", dbname="helio_intel_test") as pg:
        admin_dsn = pg.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
        subprocess.run(
            ["pnpm", "--filter", "@helio/db", "exec", "prisma", "migrate", "deploy"],
            cwd=_REPO_ROOT,
            env={"DATABASE_ADMIN_URL": admin_dsn, "PATH": os.environ["PATH"]},
            check=True,
            capture_output=True,
        )

        org_a, org_b = _new_id("org"), _new_id("org")
        ws_a, ws_b = _new_id("ws"), _new_id("ws")
        admin = await asyncpg.connect(admin_dsn)
        try:
            for org, ws, name in ((org_a, ws_a, "A"), (org_b, ws_b, "B")):
                await admin.execute(
                    "INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)",
                    org,
                    name,
                    f"slug-{org[-6:]}",
                )
                await admin.execute(
                    "INSERT INTO workspace (id, organization_id, name, slug, updated_at)"
                    " VALUES ($1, $2, $3, 'main', now())",
                    ws,
                    org,
                    name,
                )
            await admin.execute(
                "INSERT INTO contact"
                " (id, organization_id, workspace_id, email, first_name, updated_at)"
                " VALUES ($1, $2, $3, 'ada@a.com', 'Ada', now()),"
                " ($4, $2, $3, 'grace@a.com', 'Grace', now())",
                _new_id("contact"),
                org_a,
                ws_a,
                _new_id("contact"),
            )
            await admin.execute(
                "INSERT INTO contact"
                " (id, organization_id, workspace_id, email, first_name, updated_at)"
                " VALUES ($1, $2, $3, 'secret@b.com', 'Bee', now())",
                _new_id("contact"),
                org_b,
                ws_b,
            )
            await admin.execute(
                "INSERT INTO segment (id, organization_id, workspace_id, name, rule, updated_at)"
                " VALUES ($1, $2, $3, 'A pros', '{}'::jsonb, now())",
                _new_id("seg"),
                org_a,
                ws_a,
            )
        finally:
            await admin.close()

        app_dsn = admin_dsn.replace(f"{pg.username}:{pg.password}@", "helio_app:helio_app@")
        database = Database(app_dsn)
        await database.connect()
        yield {
            "repo": OrgRepository(database),
            "org_a": org_a,
            "org_b": org_b,
            "ws_a": ws_a,
            "ws_b": ws_b,
        }
        await database.close()


def _repo(seeded: dict[str, Any]) -> OrgRepository:
    return cast(OrgRepository, seeded["repo"])


async def test_scoped_reads_return_only_the_callers_org(seeded: dict[str, Any]) -> None:
    repo = _repo(seeded)
    assert await repo.count_contacts(seeded["org_a"], seeded["ws_a"]) == 2
    assert await repo.count_contacts(seeded["org_b"], seeded["ws_b"]) == 1

    emails = {c["email"] for c in await repo.search_contacts(seeded["org_a"], seeded["ws_a"], "")}
    assert emails == {"ada@a.com", "grace@a.com"}


async def test_cannot_read_another_org_even_with_its_workspace_id(
    seeded: dict[str, Any],
) -> None:
    repo = _repo(seeded)
    # Scope to org A but pass org B's workspace id — RLS must hide B's rows.
    assert await repo.search_contacts(seeded["org_a"], seeded["ws_b"], "") == []
    assert await repo.count_contacts(seeded["org_a"], seeded["ws_b"]) == 0
    # B's segment is invisible to A.
    assert await repo.list_segments(seeded["org_b"], seeded["ws_b"]) == []


async def test_workspace_summary_is_scoped(seeded: dict[str, Any]) -> None:
    repo = _repo(seeded)
    summary = await repo.workspace_summary(seeded["org_a"], seeded["ws_a"])
    assert summary.contacts == 2
    assert summary.segments == 1
