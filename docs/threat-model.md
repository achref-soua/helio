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

## v2 additions

- **Credential vault (ADR-0019).** Threat: database theft exposing provider
  secrets. Mitigation: AES-256-GCM envelopes keyed by `HELIO_ENCRYPTION_KEY`
  (never stored beside the data), AAD binding ciphertext to its row and
  field so envelopes cannot be replayed elsewhere, masked reads everywhere.
  Residual: an attacker with BOTH the database and the deployment env owns
  the secrets — documented; the backup guide pairs dumps with the key file.
- **Model uploads (ADR-0021).** Threat: RCE via uploaded artifacts.
  Mitigation: pickle refused by magic byte regardless of extension; ONNX/
  XGBoost parsed only inside a child process under address-space/CPU/wall
  rlimits with a scrubbed environment; HTTPS endpoint connector refuses
  private addresses unless the deployment opts in.
- **Database Studio.** Threat: an admin UI becoming a data-exfiltration or
  privilege tool. Mitigation: hand-rolled allow-list (no auth/credential/
  secret tables exist in it, enforced by tests), RLS underneath, validated
  writes, owner-only deletes, full audit.
- **First-run + signups.** Threat: instance takeover before the owner
  arrives, or stranger signups later. Mitigation: bootstrap locks at the
  first user and is rate-limited; bundles ship invite-only
  (`ALLOW_PUBLIC_SIGNUP=false`), enforced in the auth kernel.
- **API keys.** Threat: an over-privileged integration key leaking.
  Mitigation: per-resource scopes checked explicitly in every handler;
  rotate by minting per-consumer keys.
- **Backup downloads.** Threat: path traversal / unauthorized dump access.
  Mitigation: filenames come exclusively from database rows, the volume is
  mounted read-only, owner-gated and rate-limited.
- **Account security.** Enumeration-safe resets, zxcvbn minimums, session
  revocation, optional org password rotation and org-required 2FA.
