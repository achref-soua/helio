# ADR-0004: Better-Auth as the auth kernel on the admin connection

**Status:** accepted · 2026-06-07

## Context

Helio needs orgs, invitations, roles, 2FA, and API keys without rebuilding identity. Better-Auth's organization/twoFactor/apiKey plugins map 1:1. Its tables don't fit per-tenant RLS (users span orgs; sessions precede org context).

## Decision

Better-Auth runs inside the dashboard process and connects with the **admin role**: the kernel enforces membership and session integrity itself. Identity tables are revoked from `helio_app` entirely (`auth_rls_lockdown` migration), so the RLS plane cannot read identity data even by accident. Org roles are owner/admin/editor/viewer over Better-Auth access control; domain-level rights are gated in tRPC via core's `hasRole`. Auth tables are hand-written in the Prisma schema — the upstream CLI generator is incompatible with current better-auth (split packages, version skew) — and version-pinned quirks are documented in the schema comments.

## Consequences

A crisp trust boundary: kernel (admin, identity) vs domain plane (RLS). Schema upkeep for Better-Auth upgrades is manual; covered by the auth e2e suite.
