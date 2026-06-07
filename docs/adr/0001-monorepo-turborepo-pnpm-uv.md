# ADR-0001: Turborepo monorepo with pnpm and uv

**Status:** accepted · 2026-06-07

## Context

Helio spans a dashboard, multiple TypeScript services, shared packages, and a Python service. They version together, share types and configs, and must be runnable with one command.

## Decision

One monorepo: pnpm workspaces + Turborepo for the TypeScript graph (task orchestration, caching, `dependsOn` chains such as Prisma generate before dependent builds); uv owns the Python service end to end (toolchain, lockfile, scripts). Internal packages export TypeScript source directly and are compiled by each consumer ("internal packages" pattern) — no build step for shared code.

## Consequences

Atomic cross-cutting changes and a single quality pipeline. pnpm 11 build-script allow-listing and per-package strictness apply (`allowBuilds` in `pnpm-workspace.yaml`). Python stays decoupled except for CI and compose.
