# Security Policy

## Supported versions

Helio is pre-1.0. Only the latest release receives security fixes.

| Version        | Supported |
| -------------- | --------- |
| latest release | ✅        |
| older releases | ❌        |

## Reporting a vulnerability

Please report vulnerabilities **privately** — do not open a public issue.

- Preferred: [GitHub private vulnerability reporting](https://github.com/achref-soua/helio/security/advisories/new)
- Alternatively: email **achref.soua@outlook.com** with subject `[helio security]`

Include reproduction steps, affected component/endpoint, and impact assessment if you have one.

## What to expect

- Acknowledgement within **72 hours**.
- A fix or mitigation plan within **14 days** for confirmed issues (severity-dependent).
- Coordinated disclosure: we ask for up to **90 days** before public details, and credit reporters in the release notes unless you prefer otherwise.

## Scope notes

Self-hosted deployments are configured by their operators; misconfiguration of a deployment (e.g. exposing internal services publicly) is out of scope, but hardening guidance contributions are welcome.

## v2 security surfaces (what changed and how it is defended)

| Surface              | Defense                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential vault     | AES-256-GCM envelopes, row-bound AAD, masked reads only, zero-downtime key rotation (ADR-0019)                                                           |
| Backups              | Sidecar-owned dumps, checksummed, optional passphrase encryption; downloads stream by DB-row filename only, owner-gated and rate-limited (ADR-0020)      |
| BYO churn models     | Pickle refused by magic byte; artifacts execute only in a rlimit-sandboxed child process; HTTPS endpoints SSRF-guarded (ADR-0021)                        |
| Database Studio      | Hand-rolled allow-list — auth/credential/secret tables are not browsable by construction; validated writes; full audit; owner-only typed-confirm deletes |
| First-run setup      | Locks shut at the first user; rate-limited; instances are invite-only by default afterwards (`ALLOW_PUBLIC_SIGNUP=false` in the bundle)                  |
| REST API keys        | Per-resource scopes with explicit per-handler checks; org-embedded keys verified by whole-key hash behind RLS                                            |
| Passwords & sessions | zxcvbn gate, enumeration-safe reset, session list/revoke, optional org rotation policy, optional org-required 2FA (any RFC-6238 app)                     |
| Install pipeline     | Release bundles and binaries ship sha256 checksums; `helio install` verifies before extracting                                                           |
