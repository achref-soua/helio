# REST API

Helio exposes a typed REST gateway (`apps/api`) with an auto-generated
OpenAPI 3.1 document at [`apps/api/openapi.json`](../apps/api/openapi.json).
Errors follow RFC 9457 problem+json; mutating endpoints accept an
`Idempotency-Key`.

## Authentication

Every `/v1` request is authenticated with a **per-organization API key**.
Create one in **Settings → API keys** (owner/admin); the secret is shown
once. Send it as a bearer token:

```bash
curl https://<your-helio-host>/v1/workspaces \
  -H "Authorization: Bearer hk_<org>.xxxxxxxx"
```

The key is scoped to the organization that minted it — there is no
`organizationId` parameter, and a key can never read or write another
tenant's data. Only a SHA-256 hash of the key is stored; revoke a key at any
time from the same settings page.

## Conventions

- **Errors** are `application/problem+json` (RFC 9457): `{ type, title, status, detail }`.
- **Idempotency**: send `Idempotency-Key: <uuid>` on a `POST`; repeating the
  key replays the original response instead of acting twice.
- **Rate limiting**: responses carry `RateLimit-Limit`/`RateLimit-Remaining`;
  a `429` includes `Retry-After`.

## Example: workspaces

```bash
# List the key's organization's workspaces
curl https://<host>/v1/workspaces -H "Authorization: Bearer $HELIO_KEY"

# Create one (idempotent)
curl -X POST https://<host>/v1/workspaces \
  -H "Authorization: Bearer $HELIO_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Production","slug":"production"}'
```

The full surface — request/response schemas and every endpoint — is the
OpenAPI document, which the contract test keeps in lockstep with the code.
See [ADR-0015](adr/0015-gateway-api-keys.md) for the auth design.
