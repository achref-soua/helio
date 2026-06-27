# /settings hydration — code-splitting the panels

## Problem

`/settings` is one long page that renders ~19 interactive client panels at once
(members, security, SSO, SCIM, API keys, credentials, deliverability, webhooks,
integrations, branding, currency, analytics, churn model, backups, updates,
support, about…). They were all statically imported into the server page, so
every panel's JavaScript landed in the route's **first-load** bundle. On a weak
machine the browser had to download, parse, and hydrate all 19 before any single
panel became responsive — which is why clicking "Create" in one panel could do
nothing for a beat (the dialog's panel had not hydrated yet).

## Change

The panels are now lazy client boundaries. The `next/dynamic` definitions live in
a **client** module (`app/(dashboard)/settings/panels.tsx`) rather than the
server `page.tsx` — that distinction matters: `next/dynamic` only produces a real
async chunk + Suspense boundary when the boundary is declared in a client module.
From a server component it bundles like a static import (measured: no change).

`ssr` stays on (the default), so the server still renders each panel's HTML and
**first paint is identical — no skeleton flash, no layout shift, no UI/UX
change**. The difference is purely how the client loads and hydrates: each panel
is its own async chunk with its own hydration boundary, so React hydrates them
independently and prioritizes the panel you interact with first (selective
hydration) instead of blocking the main thread on all 19.

## Measurement

Bundle size is measured from the production build's client-reference-manifest
(the authoritative route → client-chunk map), summing the on-disk bytes of the
chunks the route's **synchronous** client modules reference. Reproduce:

```bash
pnpm --filter @helio/web build
node scripts/perf/measure-settings-bundle.mjs apps/web/.next
```

| Metric (`/settings`)            |   Before |    After | Δ                     |
| ------------------------------- | -------: | -------: | --------------------- |
| First-load client JS (uncompr.) | 910.1 KB | 817.9 KB | **−92.2 KB (−10.1%)** |
| Client modules in the route     |       62 |       30 | −32                   |
| Panel modules in first-load     |       34 |        0 | **−34**               |

The ~92 KB of panel-specific code moves out of the first-load path into
on-demand chunks; the shared vendor chunks (React, TanStack Query, Radix, sonner)
that other client modules on the page also need stay, as expected. Numbers are
uncompressed bytes — a consistent before/after metric, not the gzipped wire size.

Wall-clock time-to-interactive was not profiled in CI here (it needs an
authenticated, running build on representative hardware; this is a shared box).
The improvement follows directly from a smaller first-load payload plus
per-panel selective hydration; verify on a target machine with the browser
Performance panel or Lighthouse if a hard number is needed.

## Why not other approaches

- **`ssr: false`** would drop each panel's server HTML and pop it in after the
  chunk loads — a visible UX change (blank → content, layout shift). Rejected.
- **Visibility-gated hydration (IntersectionObserver)** would also change SSR /
  first paint and risks hydration mismatches. Rejected for the same reason.
- **`next/dynamic` from the server page** — measured to not code-split at all
  (the manifest was unchanged); the boundary must be a client module.
