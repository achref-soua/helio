# ADR-0009: Conventional commits, squash train, release-please

**Status:** accepted · 2026-06-07

## Context

History must stay linear and reviewable, and releases need automated changelogs.

## Decision

Short-lived branches off `develop`; squash-merge with the PR title as the commit title (commitlint validates titles in CI; lefthook validates locally). Both long-lived branches are ruleset-protected (PR-only, linear history, no force-push). release-please watches `main` and cuts SemVer tags + changelog at phase boundaries via `develop → main` release PRs.

## Consequences

One tidy commit per feature; releases are mechanical. Squash-merging stacked PRs requires rebasing successors — accepted as routine.

## Amendment (2026-06-08, v0.2.0)

Squashing release PRs broke the trainline: the v0.1.0 squash left `main`
without `develop`'s commit lineage, so every later `develop → main` PR
conflicted wholesale. Corrected during the v0.2.0 release:

- **Feature PRs into `develop`: squash-merge** (unchanged — one tidy
  commit per feature, linear history enforced on `develop`).
- **Release PRs into `main`: merge commits.** `main` no longer requires
  linear history; it records one merge commit per release on top of the
  shared history. A one-time `-s ours` bridge merge reconciled the
  v0.1.0 squash (develop's tree, byte-for-byte, was kept).
