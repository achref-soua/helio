# Contributing to Helio

Thanks for your interest in improving Helio! This document describes how the project is developed and what a contribution needs to be merged.

## Code of conduct

This project is governed by the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it. Please report unacceptable behavior to **achref.soua@outlook.com**.

## Prerequisites

| Tool    | Version | Notes                                       |
| ------- | ------- | ------------------------------------------- |
| Node.js | ≥ 20.9  | `.nvmrc` pins the recommended version       |
| pnpm    | 11.x    | `corepack enable` or standalone install     |
| Python  | 3.12    | managed via `uv` — no system install needed |
| uv      | latest  | Python env & dependency manager             |
| Docker  | ≥ 24    | with the Compose plugin                     |
| go-task | 3.x     | task runner (`task --list`)                 |

## Getting started

```bash
git clone https://github.com/achref-soua/helio.git
cd helio
task setup        # installs dependencies and git hooks
```

Git hooks (secret scanning, format check, commit-message lint) install automatically with `pnpm install`.

## Branching model

- `main` — stable releases only. Tagged with SemVer.
- `develop` — integration branch. All feature work targets it.
- Work happens on short-lived branches off `develop`:
  `feature/<area>-<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`, `docs/<short-desc>`, `refactor/<short-desc>`.

Both `main` and `develop` are protected: changes land only through pull requests with green CI. Feature PRs into `develop` are **squash-merged** (one commit per feature, linear history); release PRs into `main` use **merge commits** so the branches share history (see ADR-0009's amendment).

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are enforced by commitlint:

```
feat(segments): add nested AND/OR condition groups

Explain the why in the body when it is not obvious from the title.
```

Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`, `style`, `revert`.

## Pull requests

- **Small and single-purpose.** A PR that mixes several concerns will be asked to split.
- The **PR title becomes the squash-commit title** — write it as a Conventional Commit.
- The **PR description becomes the squash-commit body** — keep it imperative prose explaining what and why.
- Every PR ships with:
  - tests for new behavior (no skipped tests, no coverage theater),
  - documentation updates (README, docs page, or API spec as relevant),
  - `.env.example` entries for any new environment variable.
- Rebase on `develop` before merge; CI must be green.
  > **Note:** hosted GitHub Actions are currently disabled on this repository
  > (no Actions budget) and Actions are switched off repo-wide so failed-run
  > notifications never fire. Until that changes, `task verify` and
  > `task verify:e2e` run the exact CI commands locally and constitute the
  > merge gate. The workflows in `.github/workflows/` are kept current and
  > activate automatically if Actions become available.

## Code style

- Formatting is Prettier-enforced (`task format`); linting and type-checking run per package (`task lint`, `task typecheck`).
- No `@ts-ignore`, no commented-out code, no stray `console.log`.
- Domain logic lives in `packages/core`; framework code stays at the edges.

## Reporting security issues

Please do **not** open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
