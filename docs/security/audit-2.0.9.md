# Helio v2.0.9 — Security & Performance Audit

- **Date:** 2026-06-16
- **Scope:** Full codebase (SAST) + targeted dynamic verification + the v2.0.8 → v2.0.9 hardening pass
- **Baseline reviewed:** v2.0.8 (`d7d563c`)
- **Method:** static analysis (gitleaks, semgrep, `pnpm audit`, `pip-audit`), code-path review of the auth/tenancy/injection/SSRF surfaces, unit + integration tests (incl. PostgreSQL RLS via Testcontainers), and a live PgBouncer transaction-pooling check.

## Executive summary

Helio v2.0.8 was already well secured: multi-tenant isolation is enforced at the
database with PostgreSQL row-level security under a non-superuser role
(`helio_app`, `NOBYPASSRLS`, `FORCE ROW LEVEL SECURITY` on every tenant table),
the tenant id is bound transaction-locally so it cannot leak across requests,
the analytics SQL explorer is structurally allow-listed, public HTML surfaces
render with `textContent` and re-validated values, and API keys are hashed and
scoped. The marquee attacks against a multi-tenant SaaS — cross-tenant
BOLA/IDOR, SQL injection, stored XSS — are defended by construction, and the
review confirmed rather than broke them.

The audit found a focused set of genuine, fixable issues, all now remediated and
shipped in v2.0.9: **server-side request forgery (SSRF)** on the two paths that
fetch operator-supplied URLs (outbound webhooks and credential "test connection"
probes); a **missing service credential** between the dashboard and the
intelligence (AI) plane — the one tenant-data path that sits outside Postgres
RLS; a **rate-limiter that failed the whole API on a Redis blip**; a **missing
Kubernetes NetworkPolicy**; and **four dependency advisories**. Two performance
features landed alongside (opt-in PgBouncer transaction pooling and a shared
write-key cache on the ingest hot path), both proven correct and tenant-safe.

After remediation, the full merge gate is green across all packages, every fix
carries a regression test, and no Critical or High issue remains open.

## Severity distribution

| Severity | Found | Fixed | Accepted risk |
| -------- | ----- | ----- | ------------- |
| Critical | 0     | 0     | 0             |
| High     | 0     | 0     | 0             |
| Medium   | 3     | 3     | 0             |
| Low      | 4     | 4     | 0             |
| Info     | —     | —     | —             |

(SSRF was assessed Medium given it is reachable only by an authenticated
workspace admin and the intelligence plane is internal-only by default; it would
be High where the intelligence service is network-exposed.)

## Section 1 — Authentication & session management

**Assessed: strong; no changes required.** better-auth with database-backed
sessions (revoked by deletion), a 32-char-min `BETTER_AUTH_SECRET`, secure
cookie defaults, rate-limited credential and 2FA endpoints, TOTP 2FA, and
OIDC SSO + SCIM (token hashed at rest). API keys are `hk_<org>.<secret>`, stored
as a SHA-256 hash, scope-checked per handler, and resolved behind RLS.

## Section 2 — Authorization & multi-tenancy

**Assessed: strong.** Every tenant query runs through `forTenant` (TS) /
`Database.scoped` (Python), which sets `app.org_id` with
`set_config('app.org_id', …, true)` inside a transaction; RLS policies read it
with `current_setting`. The app role cannot bypass RLS and the auth tables are
revoked from it entirely. tRPC adds an explicit membership + `requirePermission`
gate on top.

This transaction-local design was **verified safe behind PgBouncer transaction
pooling** (added in v2.0.9): through the pooler, a query with no GUC returns 0
rows, the same query inside a transaction that sets `app.org_id` returns exactly
that org's row, and the **next pooled query returns 0 again** — the tenant
context never leaks to the connection's next client.

## Section 3 — Injection (SQL / XSS / SSRF)

- **SQL injection — defended.** Raw SQL uses parameterized template tags; the
  analytics SQL explorer (`packages/core/sql-guard.ts`, 27 tests) enforces a
  single read-only statement, blocks comments/quoted identifiers/table
  functions, and rewrites `events` to a workspace-scoped CTE; segment predicates
  compile to parameterized ClickHouse queries.
- **XSS — defended.** Public embeds (`widget.js`, in-app, landing, forms) use
  `textContent` and re-validate palette/brand values to hex; email rendering is
  block-based via React Email; CSP is set (with documented `unsafe-inline` for
  Next.js bootstrap).
- **SSRF — fixed (Medium).** Two paths fetched operator-supplied URLs with no
  validation:
  - **F1 — outbound webhook delivery** (`apps/workers`) could be pointed at
    `169.254.169.254`, `127.0.0.1:6379`, or any RFC1918 host.
  - **F2 — credential test-probe** (`apps/web`, churn endpoint / self-hosted
    LLM base URL) had the same exposure on the TS side (the Python model
    invocation was already guarded).

  Both now run a shared guard, `assertPublicUrl` in `@helio/core` (PR #277),
  which rejects non-`http(s)` schemes and any host that is — or DNS-resolves to
  — a private/loopback/link-local/reserved address (IPv4 incl. CGNAT and the
  test-nets; IPv6 incl. ULA/link-local and IPv4-mapped forms), and relies on
  WHATWG URL normalization to close the decimal/hex/octal-IPv4 bypass. Operators
  can opt a trusted LAN target back in (`HELIO_ALLOW_PRIVATE_WEBHOOKS`,
  `INTEL_ALLOW_PRIVATE_MODEL_ENDPOINTS`). PRs #278, #279.

## Section 4 — Service-to-service authentication (headline fix)

**F3 — intelligence plane unauthenticated (Medium; High if exposed) — fixed.**
The Python `/v1` API sets the RLS tenant from the `organization_id` its caller
forwards, trusting the dashboard to have authenticated the user — but the
dashboard sent no credential. Anyone able to reach `INTELLIGENCE_URL` could
forward any org id and read that tenant's data (copilot, scoring, segment /
journey / email drafting) through the AI plane, the one tenant-data path outside
Postgres RLS.

Fixed in PR #280: both sides share `INTEL_SERVICE_TOKEN`; a FastAPI middleware
rejects any `/v1` request without a matching `X-Helio-Service-Token` (health,
readiness, metrics stay open); the web client sends it. Secure-by-default in the
shipped deploys — the self-host bundle generates the token per install and wires
it to both services, and the Helm chart carries it in the chart Secret. The MCP
server is unaffected (stdio transport, scoped to a single configured workspace).

## Section 5 — Configuration & infrastructure

- **F4 — rate-limit fail-mode (Low) — fixed.** The gateway limiter `await`ed
  Redis unguarded, so a Redis outage 500'd every `/v1` request. It now degrades
  to a per-replica in-memory window of the same shape and flags the outage on
  the trace (PR #281).
- **F5 — Kubernetes NetworkPolicy missing (Low) — fixed.** The Helm chart gained
  an opt-in `networkPolicy` (default-deny ingress, intra-release allow, and the
  intelligence plane restricted to web + workers — defence in depth for F3),
  plus pinned the five dev-compose sidecars that floated on `:latest` (PR #282).
- **Headers / CORS — confirmed correct.** Security headers and a CSP are set;
  public embed endpoints use open CORS without credentials and are rate-limited.

## Section 6 — Supply chain

`gitleaks` (full history) and `semgrep` (OWASP Top-Ten + Python, 366 files) were
clean. `pnpm audit` and `pip-audit` surfaced four patchable advisories, all
fixed in PR #276:

| Package      | Advisory                       | Fix                 |
| ------------ | ------------------------------ | ------------------- |
| protobufjs   | GHSA-f38q-mgvj-vph7            | override → `^7.6.3` |
| js-yaml      | GHSA-h67p-54hq-rp68 (dev-only) | override → `^4.1.2` |
| cryptography | GHSA-537c-gmf6-5ccf            | `>=48.0.1`          |
| starlette    | CVE-2026-54282 / -54283        | pinned `>=1.3.1`    |

`pip-audit` reports no known vulnerabilities after the bump. Container images are
additionally Trivy-scanned (Critical) by the release pipeline.

## Section 7 — Performance

Two pooling/caching features landed, both **correctness- and tenant-safety
validated**; throughput gains are deployment-specific and are to be benchmarked
on reference hardware (this audit does not publish synthetic single-box numbers).

- **PgBouncer transaction pooling (opt-in, PR #283).** Fronts the `helio_app`
  RLS connection so many app connections share a few Postgres backends; the admin
  connection stays direct. Off by default (no change to existing deployments or
  the auto-update path). Safe because of the transaction-local tenant GUC, which
  was verified live through the pooler (Section 2). ADR-0022.
- **Shared write-key L2 cache (PR #284).** Ingestion resolves a write key to its
  workspace on every event; that lookup gained an optional shared Redis L2 behind
  the existing in-process L1, so cold/scaled replicas resolve from Redis rather
  than Postgres. Tenant-safe by construction (the cache key is the write key,
  which is globally unique and 1:1 with a workspace) and fail-open. ADR-0023.

## Section 8 — Security features (overview)

- **Tenancy:** PostgreSQL RLS under a non-superuser role with `FORCE` policies +
  transaction-local tenant GUC; application-layer membership/permission gate.
- **Service mesh:** shared-token auth on the intelligence `/v1` API; opt-in
  Kubernetes NetworkPolicy restricting the AI plane to web + workers.
- **Egress:** SSRF guard on every server-side fetch of an operator-supplied URL.
- **Auth:** better-auth, DB sessions, TOTP 2FA, OIDC SSO, SCIM; hashed scoped
  API keys; rate-limited credential/2FA endpoints; resilient gateway limiter.
- **Data:** AES-256-GCM credential vault with per-row AAD and key rotation;
  ONNX/XGBoost-only model upload (pickle refused) in a sandboxed child.
- **Supply chain:** gitleaks pre-commit, dependency advisories patched, Trivy
  image scans, sha256-verified install bundles.

## Section 9 — Recommendations (post-v2.0.9)

1. Shared-store rate limiting for login/2FA across replicas (better-auth
   secondary storage) — currently per-replica in-process.
2. Connection-pinning on the SSRF guard to fully close the DNS-rebinding window
   (the current resolve-then-fetch is adequate for the operator threat model).
3. Org-scoped entity caches (contact-by-id, segment membership) once their
   benefit is benchmarked and invalidation is proven (deferred — ADR-0023).
4. Publish reference-hardware throughput numbers for ingestion and the send path.

## Appendix A — Findings & fixes

| ID  | Severity | Finding                                    | Fix (PR)   |
| --- | -------- | ------------------------------------------ | ---------- |
| F1  | Medium   | SSRF — outbound webhook delivery           | #277, #278 |
| F2  | Medium   | SSRF — credential test-probe               | #277, #279 |
| F3  | Medium\* | Intelligence `/v1` unauthenticated         | #280       |
| F4  | Low      | Rate limiter 500s on Redis outage          | #281       |
| F5  | Low      | Helm NetworkPolicy missing; `:latest` tags | #282       |
| D1  | Low      | protobufjs / js-yaml advisories            | #276       |
| D2  | Low      | cryptography / starlette advisories        | #276       |

\* High where the intelligence service is network-exposed.

## Appendix B — Verification evidence

- **Static:** gitleaks (266 commits) — no leaks; semgrep (OWASP + Python, 366
  files) — 0 findings; `pnpm audit` 2→0 moderate; `pip-audit` → no known vulns.
- **Tests (all green):** TS — every package (core 47 files, workers 14 incl.
  Testcontainers integration, api, ingest, db, tracking, sdk-js, bus);
  intelligence — 128 passed at 88% coverage (incl. RLS data-isolation via
  Testcontainers); sdk-py — 10 passed. Each fix ships a regression test (SSRF
  classifier + guard, webhook/probe refusal, intelligence 401/200, rate-limit
  fallback, write-key cross-tenant cache).
- **Live:** PgBouncer transaction-mode RLS check (no GUC → 0 rows; in-txn with
  GUC → the org's row; next pooled query → 0 again).
- **Not run (constrained):** full ZAP active scan, a second full live stack for
  BOLA fuzzing, and a ≥5k/s k6 load run were not performed on the shared build
  host (memory-constrained alongside other workloads); the corresponding
  properties are covered by the RLS Testcontainers tests, the SSRF/auth unit
  tests, and the live pooler check above. Throughput numbers are deferred to
  reference hardware rather than fabricated.
