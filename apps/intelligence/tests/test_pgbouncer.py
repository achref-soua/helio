from helio_intelligence.data.db import Database
from helio_intelligence.settings import Settings


def test_pgbouncer_flag_reads_from_environment(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("INTEL_DATABASE_PGBOUNCER", "true")
    assert Settings().database_pgbouncer is True
    monkeypatch.setenv("INTEL_DATABASE_PGBOUNCER", "false")
    assert Settings().database_pgbouncer is False


def test_database_disables_statement_cache_for_pgbouncer() -> None:
    # Behind a transaction pooler the statement cache must be off; direct
    # connections keep asyncpg's default for the small caching win.
    assert Database("postgresql://x", statement_cache_size=0)._statement_cache_size == 0
    assert Database("postgresql://x")._statement_cache_size == 100
