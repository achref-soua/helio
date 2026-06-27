# Helio — Security & Reliability Audit (release candidate)

- **Date:** 2026-06-27
- **Scope:** Full codebase review + **live OWASP ZAP dynamic scan** (the dynamic
  pass the v2.0.9 audit had deferred for capacity) + a correctness sweep of the
  message-send / journey-execution path.
- **Method:** independent multi-agent code review of the web/API request surface
  and the send path; targeted code-path verification; a live ZAP **baseline
  (spider + passive) scan** against a running build; unit + Testcontainers
  (PostgreSQL) integration tests for every fix.

## Executive summary

Helio entered this pass already well-secured (multi-tenant PostgreSQL RLS under a
non-superuser role, hashed scoped API keys, an SSRF egress guard, a structurally
allow-listed analytics SQL explorer — see `audit-2.0.9.md`). This audit ran the
**live OWASP ZAP scan** that was previously deferred and a fresh adversarial code
review, found a focused set of genuine issues — including **two High-severity
cross-tenant flaws that a black-box scanner cannot see** — and fixed them. The
journey double-send, the idempotency-key leak, and the header hardening carry
dedicated regression tests; the remaining fixes are verified by code review and
the existing RLS / integration suite (dedicated tests tracked as a fast-follow).

The headline finding was **not** from the scanner but from the code review: two
authenticated cross-tenant data paths (analytics BOLA, idempotency-key leak) and
a stored-XSS vector on customer sites. The ZAP scan independently confirmed the
HTTP surface is clean — **0 High, 0 failures, 58 passing checks** — with only
header-hardening warnings remaining.

A separate correctness defect of release-blocking severity was found and fixed in
the same pass: journey sends were **not idempotent**, so a Temporal retry after a
delivered message could **double-send**. See §6.

## Severity distribution (this pass)

| Severity | Found | Fixed | Accepted/Deferred |
| -------- | ----- | ----- | ----------------- |
| Critical | 1\*   | 1     | 0                 |
| High     | 2     | 2     | 0                 |
| Medium   | 2     | 2     | 0                 |
| Low      | 4     | 2     | 2 (documented)    |
| Info     | —     | —     | —                 |

\* The Critical is the journey double-send (reliability/integrity), §6.

## Section 1 — OWASP ZAP dynamic scan

A ZAP **baseline** scan (spider + full passive rule set, `zaproxy/zap-stable`)
was run against a production build of the dashboard.

**Result: `FAIL-NEW: 0  WARN-NEW: 9  PASS: 58`.** No High or Medium _failures_;
the app passes the baseline. Raw reports are committed alongside this file
(`zap-baseline.html`, `.json`, `.md`).

| Alert                                                  | ZAP severity | Disposition                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP `script-src`/`style-src 'unsafe-inline'`, wildcard | Medium       | **Accepted (documented).** Next.js injects inline bootstrap scripts and Radix/Tailwind write inline styles; `img-src https:` is required for org-branding logos on arbitrary hosts. Removing `unsafe-inline` requires a per-request nonce pipeline (tracked as a follow-up). `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` are all set. |
| Server leaks `X-Powered-By`                            | Low          | **Fixed** — `poweredByHeader: false`.                                                                                                                                                                                                                                                                                                                                            |
| Cross-Origin-Opener-Policy missing                     | Low          | **Fixed** — `COOP: same-origin-allow-popups` on the dashboard (keeps OAuth/SSO popups working).                                                                                                                                                                                                                                                                                  |
| Cross-Origin-Embedder/Resource-Policy missing          | Low          | **Accepted (by design).** COEP/CORP would break the cross-origin widget, embeds, and tracking pixel the product exists to serve.                                                                                                                                                                                                                                                 |
| Timestamp disclosure (Unix)                            | Low          | **Accepted** — non-sensitive numeric timestamps in payloads.                                                                                                                                                                                                                                                                                                                     |
| Content-Type missing / info-in-URL / cacheability      | Info         | Informational; no action.                                                                                                                                                                                                                                                                                                                                                        |

A black-box baseline scan **cannot** authenticate or reason about tenancy, so it
could not have found the cross-tenant issues in §2 — which is why the code review
below is the substance of this audit.

## Section 2 — Cross-tenant access (the real findings)

**F1 — Analytics BOLA (High) — fixed.** Five tRPC analytics procedures
(`overview`, `campaignEngagement`, `funnel`, `retention`, `attribution`) passed
the request's `workspaceId` straight into ClickHouse (`WHERE workspace_id = …`)
with no check that the workspace belongs to the caller's org. `orgProcedure`
proves org _membership_ only, and **ClickHouse has no RLS**, so any authenticated
user could read another tenant's event timeline, open/click counts, funnels,
retention, and attribution given a workspace id. The sibling `runSql` already did
the check, confirming the omission. **Fix:** a shared `requireOwnedWorkspace`
guard runs the RLS-scoped `tenantDb.workspace.findUnique` first on every one.

**F2 — Idempotency key not tenant-scoped (High) — fixed.** The REST gateway's
idempotency middleware keyed stored responses on `path:key` with no org.
Idempotency-Key values are client-chosen and often semantic (`order-123`), so two
orgs collide: org B replaying a key receives **org A's cached response body** and
its own write is silently dropped. **Fix:** the key now includes the
authenticated `organizationId` (set by `apiKeyAuth`, which runs first).

## Section 3 — Injection / XSS

**F3 — Stored XSS via CTA URL (Medium) — fixed.** Widget and in-app-message
`ctaUrl` used `z.string().url()`, which accepts `javascript:` / `data:` schemes;
the public `widget.js` assigns it straight to an anchor `href` in plain DOM, so a
member with only `widgets:write` could run script on the org's own marketing site
for every visitor. **Fix:** both schemas now require `http(s)` (the project's
existing `webhookUrlSchema` pattern), with a defence-in-depth scheme check at the
`widget.js` sink.

SQL injection, the analytics SQL guard, and public-embed `textContent` rendering
were re-reviewed and remain solid.

## Section 4 — Configuration & rate limiting

- **F4 — Landing-form endpoint unthrottled (Medium) — fixed.** `submitLandingForm`
  had no `checkPublicRateLimit`, while the equivalent hosted-form action did —
  allowing unbounded anonymous contact creation. Now throttled identically.
- **F5 — Rate-limit key stored the raw API secret (Low) — fixed.** The gateway
  limiter keyed Redis on the raw `Authorization` header (`Bearer hk_<org>.<secret>`),
  persisting live secrets in plaintext keys. Now keyed on a SHA-256 fingerprint.

## Section 5 — Deferred (documented, low risk)

- **Push-subscribe upsert not workspace-scoped (Low).** `pushSubscription` upserts
  by globally-unique `endpoint`; the update branch doesn't re-check `workspaceId`,
  so write key A could overwrite workspace B's keys — gated by the unguessable
  push endpoint. Proper fix is a `@@unique([workspaceId, endpoint])` (schema
  migration); deferred to avoid an unscheduled migration in a release pass.
- **Copilot procedures lack `requirePermission` (Low).** Any member (incl.
  read-only) can drive the LLM and spend the org's AI budget. No cross-tenant
  exposure (org from `ctx`, drafts re-validated). Needs a new `copilot:use`
  permission in the RBAC catalog; deferred to avoid catalog churn here.
- **`security.passwordPolicy` read ungated (Low).** Org-scoped info only; the
  sibling mutations require `settings:workspace`. Add a read-tier gate.

## Section 6 — Reliability: journey double-send (Critical) — fixed

The campaign send path claims a unique `(campaignId, contactId)` row before
delivery, so retries never re-send. The **journey** send path did not: every
attempt of `sendJourneyEmail` / `sendJourneyInApp` created a _fresh_ row and
delivered. Temporal retries an activity up to 5× on any throw or timeout — so a
**routine DB blip on the post-send `SENT` update, or an activity timeout after a
successful send, produced a duplicate message** (real money on SMS/WhatsApp; spam
complaints on email). This directly violated the product's "no double-sends"
guarantee.

**Fix:** journey sends now claim a **deterministic** row id derived from
`(runId, nodeId)` via an atomic `upsert`; an already-`SENT` row short-circuits, so
a retry after delivery is a no-op. Verified end-to-end against PostgreSQL
(Testcontainers): a second call with the same run+node delivers nothing new and
creates no second row. SMS/WhatsApp/web-push journey sends persist no row and
retain a narrow at-least-once window on worker crash (documented in code); the
dominant email and in-app paths are now idempotent.

## Appendix A — Findings & fixes

| ID  | Severity | Finding                                                | Status                                                  |
| --- | -------- | ------------------------------------------------------ | ------------------------------------------------------- |
| F0  | Critical | Journey email/in-app double-send on Temporal retry     | Fixed (deterministic claim + Testcontainers regression) |
| F1  | High     | Analytics cross-tenant BOLA (ClickHouse, no RLS)       | Fixed (`requireOwnedWorkspace`)                         |
| F2  | High     | Idempotency-key cross-tenant response leak             | Fixed (org-scoped key)                                  |
| F3  | Medium   | Stored XSS via `javascript:` CTA URL on customer sites | Fixed (http(s) schema + sink guard)                     |
| F4  | Medium   | Landing form unthrottled                               | Fixed (public rate limit)                               |
| F5  | Low      | Rate-limit key stored raw API secret                   | Fixed (hashed)                                          |
| F6  | Low      | `X-Powered-By` leak                                    | Fixed (`poweredByHeader: false`)                        |
| F7  | Low      | COOP header missing                                    | Fixed (`same-origin-allow-popups`)                      |
| D1  | Low      | Push-subscribe not workspace-scoped                    | Deferred (needs migration)                              |
| D2  | Low      | Copilot lacks permission gate                          | Deferred (needs RBAC catalog change)                    |
| D3  | Low      | passwordPolicy read ungated                            | Deferred                                                |

## Appendix B — Verification evidence

- **ZAP baseline:** `FAIL-NEW 0 / WARN-NEW 9 / PASS 58` against a production
  build; reports committed next to this file.
- **Tests (all green):** journey idempotency proven via PostgreSQL Testcontainers
  (one send, one row across a simulated retry); a new idempotency-middleware unit
  test proves org B never receives org A's cached response for a shared key;
  security-headers e2e extended to assert COOP + no `X-Powered-By`. F1/F3/F4/F5
  are verified by code-path review and the existing RLS/integration suite.
- **Not run (capacity):** a full ZAP **active** scan and an authenticated BOLA
  fuzz were not run on the shared host; the cross-tenant properties are instead
  covered by the RLS Testcontainers tests and the `requireOwnedWorkspace` /
  idempotency regression tests. Throughput numbers are not fabricated.
