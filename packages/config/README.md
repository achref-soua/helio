# @helio/config

Shared lint, type, format, and test presets for every package in the monorepo.

## Usage

**ESLint** (`eslint.config.mjs`):

```js
import base from '@helio/config/eslint/base';
export default base;

// React packages:
import react from '@helio/config/eslint/react';
export default react;
```

**TypeScript** (`tsconfig.json`):

```json
{ "extends": "@helio/config/typescript/node.json" }
```

Presets: `base.json`, `node.json`, `react-library.json`, `nextjs.json`.

**Vitest** (`vitest.config.ts`):

```ts
import { createVitestConfig } from '@helio/config/vitest';
export default createVitestConfig({ test: { environment: 'jsdom' } });
```

The shared config enforces a 70% coverage gate on lines, functions, branches, and statements.

**Prettier** is configured once at the repo root (`prettier.config.mjs`); `@helio/config/prettier` exposes the identical preset for tooling that needs a package import. Keep the two in sync.
