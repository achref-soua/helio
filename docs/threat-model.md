# Threat model

Working document (STRIDE-lite). Updated as attack surface grows; Phase 1 (ingestion, sending, webhooks) adds sections.

## Assets

Tenant contact data (PII), credentials/sessions/API keys, email-sending capability (abuse target), the database itself.

## Current surface & mitigations

| Threat                               | Vector                                  | Mitigation (today)                                                                                                                         |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-tenant data access             | Missing query filter, IDOR              | Postgres RLS forced on tenant tables; `forTenant` GUC scoping; integration tests prove denial (ADR-0003)                                   |
| Identity-table exposure              | App-plane query touching users/sessions | All grants revoked from `helio_app` on identity tables (ADR-0004)                                                                          |
| Credential stuffing / token guessing | Public auth + gateway                   | Better-Auth password hashing + verification-gated accounts; gateway bearer compared timing-safe; Redis rate limiting with standard headers |
| Public-endpoint abuse                | Forms, booking, embeds, SCIM            | Per-surface fixed-window budgets (IP + write-key keyed); tight Better-Auth rules on credential endpoints; unsubscribe exempt by design     |
| Replay / duplicate mutations         | Retried POSTs                           | Idempotency-Key replay store (24h, Redis)                                                                                                  |
| Secret leakage                       | Commits, images                         | gitleaks pre-commit + full-history CI scan; `.env*` git- and docker-ignored; Trivy gate on images                                          |
| Supply chain                         | Dependencies, actions                   | Renovate, pnpm/uv lockfiles, CodeQL + Semgrep, SBOM (Syft) per image, build-script allow-listing (pnpm 11)                                 |
| Privilege escalation in-org          | Role tampering                          | Roles validated against Better-Auth access control; tRPC `requireRole`; viewer denial covered by e2e                                       |
| Email abuse via dev                  | Accidental real sends                   | All dev mail terminates in Mailpit                                                                                                         |

## Accepted gaps

CSRF posture review for the gateway (cookie-less today, bearer-authenticated); nonce-based CSP (the dashboard ships a baseline CSP with `unsafe-inline` script/style, the Next.js default posture without per-request nonces); SNS signature verification on the email webhook (shared-token authenticated instead); encryption-at-rest guidance for self-hosters.

Closed since first written: ~~CSP/security headers on the dashboard~~ (baseline CSP + nosniff/referrer/permissions headers, frame-ancestors deny except embeddable hosted pages; edge services ship hono secure-headers); ~~per-user scoped API keys replacing the bootstrap token~~ (ADR-0015); ~~webhook signature verification~~ (Stripe/Shopify signatures, email shared token + ADR-0017 tenant resolvers); ~~audit-log coverage~~ (all domain mutations audit-logged).
