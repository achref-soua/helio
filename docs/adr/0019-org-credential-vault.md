# ADR-0019: Per-organization credential vault

- Status: accepted
- Date: 2026-06-11

## Context

v1 configured every delivery provider (SMTP, Twilio, WhatsApp, the LLM)
through deployment-wide environment variables. v2 makes sending real and
per-organization: each org connects its own providers, which means storing
third-party secrets in Postgres. Storing them plaintext (as
`integration.secret` already was) is unacceptable for a security-focused
release, and the readers span two languages — the TypeScript services and
the Python intelligence service.

## Decision

One generic `provider_credential` table (RLS tenant-isolated, FORCE RLS)
holds all kinds — email providers, Twilio, WhatsApp, LLM, churn endpoints,
import tokens — discriminated by a `kind` enum with a per-kind contract
(zod config schema + declared secret fields) in `@helio/core`. Secret
fields are sealed into a string envelope:

```
enc:v1:<keyfp8>:<iv_b64>:<ct_b64>:<tag_b64>
```

AES-256-GCM under `HELIO_ENCRYPTION_KEY` (base64, 32 bytes), with AAD
`helio:cred:v1:{organizationId}:{credentialId}:{field}` so a ciphertext
copied to another row, field, or tenant fails authentication. The
fingerprint segment identifies the sealing key, letting a rotation accept
`HELIO_ENCRYPTION_KEY_PREVIOUS` until an idempotent re-encrypt walk
(`packages/db/scripts/rotate-encryption-key.ts`) finishes. The same
row-bound envelope seals `integration.secret` and
`sending_domain.dkim_private_key`; legacy plaintext rows pass through
readers and are sealed by the walk.

Read paths never select the sealed column — masks render from
`{ last4, setAt }` metadata captured at write time. Decryption happens
only server-side: the dashboard's verify probes, the workers' send-time
credential store, the gateway's Shopify HMAC check (the SECURITY DEFINER
resolver now returns the row id for the AAD), and the intelligence
service.

The format is implemented twice — Web Crypto in `@helio/core`, and
`cryptography`'s AESGCM in `apps/intelligence` (byte-compatible by
construction) — and both suites replay one committed vector fixture, so
the implementations cannot drift.

## Consequences

- New required deployment secret `HELIO_ENCRYPTION_KEY` (the installer
  generates it). A backup restored without it cannot reveal credentials;
  re-entry is the recovery path, and restore tooling warns on fingerprint
  mismatch.
- Eight credential surfaces share one storage, validation, masking,
  verification, audit, and rotation path instead of per-channel tables.
- Envelope vs. pgcrypto: application-side sealing keeps the key out of
  SQL, works identically in tests and across both languages, and survives
  logical dumps without exposing plaintext.
