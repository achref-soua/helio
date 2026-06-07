# @helio/ui

Helio's design system: Tailwind CSS v4 theme tokens (CSS-first, "solar" brand — amber primary on deep-navy darks) and shadcn/ui components, documented in Storybook.

## Usage

```tsx
import '@helio/ui/styles.css'; // once, at the app root

import { Button } from '@helio/ui/components/button';
import { cn } from '@helio/ui/lib/utils';
```

Dark mode is class-based: toggle `dark` on `<html>`.

## Storybook

```bash
pnpm --filter @helio/ui storybook        # dev server on :6006
pnpm --filter @helio/ui build            # static build (CI artifact)
```

Every component story runs through the a11y addon; regressions in roles/contrast surface in CI.

## Conventions

- Components live in `src/components/ui/` and are vendored (shadcn) — edit freely, they're ours.
- Semantic tokens only (`bg-background`, `text-muted-foreground`, …); no raw palette values in app code.
- Vendored primitives are excluded from unit-test coverage; the `cn` utility and any composite components we author are unit-tested, and flows are covered by app E2E.
