# intelligence

Helio's Python plane (FastAPI, managed exclusively with **uv**). The AI copilot, predictive scoring, segment compute, and the MCP server land here in later milestones; this skeleton establishes the service shape, configuration, logging, and test conventions.

## Commands

```bash
uv sync                  # install (creates .venv, respects uv.lock)
uv run uvicorn helio_intelligence.app:app --reload   # dev server :8000
uv run pytest            # tests with the 70% coverage gate
uv run ruff check .      # lint
uv run mypy              # strict type-checking
```

Configuration comes from `INTEL_*` environment variables (see `settings.py`); structured JSON logs match the TypeScript services.
