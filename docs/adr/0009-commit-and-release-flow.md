# ADR-0009: Conventional commits, squash train, release-please

**Status:** accepted · 2026-06-07

## Context

History must stay linear and reviewable, and releases need automated changelogs.

## Decision

Short-lived branches off `develop`; squash-merge with the PR title as the commit title (commitlint validates titles in CI; lefthook validates locally). Both long-lived branches are ruleset-protected (PR-only, linear history, no force-push). release-please watches `main` and cuts SemVer tags + changelog at phase boundaries via `develop → main` release PRs.

## Consequences

One tidy commit per feature; releases are mechanical. Squash-merging stacked PRs requires rebasing successors — accepted as routine.
