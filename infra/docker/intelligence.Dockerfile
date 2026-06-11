# Helio intelligence plane — uv-managed Python on a slim runtime.
# Build context: repository root.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY apps/intelligence/pyproject.toml apps/intelligence/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY apps/intelligence/src ./src
COPY apps/intelligence/README.md ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm AS runner
WORKDIR /app
RUN groupadd --system helio && useradd --system --gid helio helio \
    && apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=helio:helio /app /app
ENV PATH="/app/.venv/bin:$PATH"
# Release identity baked at build time; surfaced on /healthz and in the UI.
ARG HELIO_VERSION
ARG HELIO_COMMIT
ENV HELIO_VERSION=$HELIO_VERSION \
    HELIO_COMMIT=$HELIO_COMMIT
USER helio
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1
CMD ["uvicorn", "helio_intelligence.app:app", "--host", "0.0.0.0", "--port", "8000"]
