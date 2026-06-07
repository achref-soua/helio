# ADR-0002: TypeScript product plane, Python intelligence plane

**Status:** accepted · 2026-06-07

## Context

The product surface (dashboard, APIs, journey workers) benefits from one type system end to end. The AI/ML surface (scoring, embeddings, copilot, MCP) lives in the Python ecosystem.

## Decision

TypeScript owns everything user-facing and orchestration (Next.js dashboard, Hono gateway, Temporal workers). Python (FastAPI, uv) owns the intelligence plane. The planes integrate over HTTP/queues — never shared code.

## Consequences

Two toolchains in CI and two service shapes in deploy, accepted for best-of-ecosystem leverage on both sides. Conventions are mirrored deliberately (structured JSON logs, /healthz + /readyz, Prometheus histograms with the same label sets).
