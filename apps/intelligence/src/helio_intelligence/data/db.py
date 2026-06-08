"""Async Postgres access bound to one organization via RLS."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import asyncpg


class ScopedConnection:
    """A connection inside a transaction pinned to one organization.

    ``app.org_id`` is set transaction-local; the RLS policies key on it,
    so any query through this connection only sees that org's rows.
    """

    def __init__(self, connection: asyncpg.pool.PoolConnectionProxy[asyncpg.Record]) -> None:
        self._connection = connection

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        return await self._connection.fetch(query, *args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        return await self._connection.fetchval(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        return await self._connection.fetchrow(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        return await self._connection.execute(query, *args)

    async def executemany(self, query: str, args: list[tuple[Any, ...]]) -> None:
        await self._connection.executemany(query, args)


class Database:
    """An asyncpg pool over the RLS-bound app connection."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=8)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def ping(self) -> bool:
        await self.connect()
        assert self._pool is not None
        return bool(await self._pool.fetchval("SELECT 1"))

    @asynccontextmanager
    async def scoped(self, organization_id: str) -> AsyncIterator[ScopedConnection]:
        """Yield a connection scoped to ``organization_id`` for one txn."""
        await self.connect()
        assert self._pool is not None
        async with self._pool.acquire() as connection, connection.transaction():
            # Transaction-local: cleared automatically at commit/abort.
            await connection.execute("SELECT set_config('app.org_id', $1, true)", organization_id)
            yield ScopedConnection(connection)
