# ADR-0017: Webhook tenant resolution under row-level security

**Status:** accepted · 2026-06-10

## Context

Provider webhooks (Stripe billing events, Shopify CDP sync, email
bounce/complaint notifications) authenticate by **signature or shared
secret**, not by a per-organization API key. The org a payload belongs to is
therefore unknown until the payload itself is matched to one — a Shopify
shop domain, a Stripe customer id, a recipient address.

The gateway connects only as the RLS-bound app role (ADR-0003/0004,
ADR-0015), whose policies key on `app.org_id`. With no tenant context set,
that role sees **zero rows**. The original webhook handlers did plain table
reads (`integration.findFirst`, `subscription.findFirst`) and writes on the
bare client — against a real database they matched nothing and failed
`WITH CHECK`. Fake-Prisma unit tests masked this; both webhooks were broken
in production conditions.

API keys solved their version of this problem by embedding the org id in
the credential (ADR-0015). Webhook payloads come from third parties — we
cannot embed anything in them.

## Decision

Introduce **narrow SECURITY DEFINER resolver functions**, owned by the
schema owner and granted to `helio_app`, one per webhook family:

- `webhook_shopify_connection(shop_domain)` → org, workspace, signing secret
- `webhook_stripe_organization(customer_id)` → org

Each exposes exactly one indexed lookup and nothing else (`EXECUTE` revoked
from `PUBLIC`, `search_path` pinned). Typed wrappers live in `@helio/db`
(`shopifyConnectionForWebhook`, `stripeOrganizationForWebhook`). Once the
tenant is resolved — and the payload's signature verified against the
resolved secret where applicable — all further reads and writes run through
`forTenant()` exactly like every other tenant path.

The alternative — giving the gateway an admin connection — was rejected: it
would turn one compromised route into full cross-tenant access, and
ADR-0015 explicitly established the gateway as admin-free. A
`BYPASSRLS`-lite GUC or policy `OR` branch was rejected for widening every
policy on every table.

## Consequences

The gateway keeps a single unprivileged role; its cross-tenant reach is
enumerable by listing `SECURITY DEFINER` functions granted to `helio_app` —
an auditable, deliberately short list. Each new webhook family adds its own
resolver in a migration rather than reusing a general escape hatch.
Integration tests in `@helio/db` pin the contract: bare reads see nothing
(the regression), resolvers return exactly their row, and tenant writes
succeed after resolution.
