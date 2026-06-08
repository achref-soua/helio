"""A tiny read-only ClickHouse client over the HTTP interface.

Only what the scoring feature pipeline needs: parameterized queries that
return rows as dicts. Server-side parameters ({name:Type}) keep the
workspace filter injection-safe.
"""

from __future__ import annotations

from typing import Any

import httpx


class ClickHouseClient:
    def __init__(
        self,
        url: str,
        *,
        user: str,
        password: str,
        database: str,
        timeout: float = 30.0,
    ) -> None:
        self._url = url.rstrip("/")
        self._auth = (user, password)
        self._database = database
        self._timeout = timeout

    async def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Run a SELECT and return rows as dicts (JSONEachRow)."""
        query_params = {
            "database": self._database,
            "default_format": "JSONEachRow",
        }
        for key, value in (params or {}).items():
            query_params[f"param_{key}"] = str(value)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                self._url,
                params=query_params,
                content=sql.encode("utf-8"),
                auth=self._auth,
            )
            response.raise_for_status()
            text = response.text.strip()
        if not text:
            return []
        import json

        return [json.loads(line) for line in text.splitlines() if line]

    async def ping(self) -> bool:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(f"{self._url}/ping")
            return response.status_code == 200
