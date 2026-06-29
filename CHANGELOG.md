# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry links to its full release notes on GitHub. Versions are tagged on
`main`; per-PR detail lives in the linked GitHub release.

## [Unreleased]

### Added

- Community health files: `SUPPORT.md`, `CITATION.cff`, and
  `.github/FUNDING.yml`; this `CHANGELOG.md`; and a project wiki (Home, FAQ,
  navigation).

## [2.3.0] — 2026-06-28

- Full Docker stack is now the default on install and update (opt out with
  `--core`); NVIDIA NIM added as an AI copilot provider.

## [2.2.5] — 2026-06-28

- Subsystem architecture diagram set and a per-release visual recap.

## [2.2.4] — 2026-06-28

- Maintenance and CI reliability fixes.

## [2.2.3] — 2026-06-28

- CI reliability: the end-to-end suite is now a blocking gate; workers coverage
  and flaky-spec fixes.

## [2.2.2] — 2026-06-28

- Patch fixes.

## [2.2.1] — 2026-06-27

- Fix a `/settings` server-rendering regression caught by the new e2e gate.

## [2.2.0] — 2026-06-27

- First fully-green release: Docker install UX repair, cloud-VM provisioning,
  `/settings` code-split, self-resetting demo, and a self-update image.

## [2.1.0] — 2026-06-27

- First CI-driven release. Critical journey double-send fix, a cross-tenant
  security audit (live OWASP ZAP, 0 High), and a script-only install wizard.

## [2.0.9] — 2026-06-15

- Security & performance pass: SSRF guard, intelligence service-token,
  opt-in PgBouncer, Redis L2 cache, Helm NetworkPolicy.

## [2.0.0] — 2026-06-12

- **Helio for humans.** One-command install, desktop/PWA app, setup wizard,
  per-org channel credentials in an encrypted vault, admin control room,
  CRM, migration wizard, BYO churn model, 2FA, and free-forever (billing
  removed). Patch releases 2.0.1–2.0.8 followed.

## [1.0.0] — 2026-06-10

- The open-source growth platform — first stable release.

## [0.10.0] — 2026-06-09

- CRM-lite, webhooks, white-labeling, and integrations.

## [0.9.0] — 2026-06-09

- Kubernetes Helm chart and deployment guides.

## [0.8.0] — 2026-06-09

- Enterprise SSO/SCIM, SDKs, and docs.

## [0.7.0] — 2026-06-08

- Opt-in Stripe billing.

## [0.6.0] — 2026-06-08

- Importers, Segment ingestion, and CRM-lite.

## [0.5.0] — 2026-06-08

- Predictive AI and autonomous A/B winner selection.

## [0.4.0] — 2026-06-08

- AI Copilot.

## [0.3.0] — 2026-06-08

- Phase 2: Growth — full journey canvas, multi-channel, landing pages, lead
  scoring, A/B testing, attribution.

## [0.2.0] — 2026-06-08

- Phase 1: the usable MVP — CDP, ingestion, segmentation, email, journeys,
  analytics, forms.

## [0.1.0] — 2026-06-07

- Phase 0: Foundation — monorepo, CI/CD, auth, multi-tenancy, observability.

[Unreleased]: https://github.com/achref-soua/helio/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/achref-soua/helio/releases/tag/v2.3.0
[2.2.5]: https://github.com/achref-soua/helio/releases/tag/v2.2.5
[2.2.4]: https://github.com/achref-soua/helio/releases/tag/v2.2.4
[2.2.3]: https://github.com/achref-soua/helio/releases/tag/v2.2.3
[2.2.2]: https://github.com/achref-soua/helio/releases/tag/v2.2.2
[2.2.1]: https://github.com/achref-soua/helio/releases/tag/v2.2.1
[2.2.0]: https://github.com/achref-soua/helio/releases/tag/v2.2.0
[2.1.0]: https://github.com/achref-soua/helio/releases/tag/v2.1.0
[2.0.9]: https://github.com/achref-soua/helio/releases/tag/v2.0.9
[2.0.0]: https://github.com/achref-soua/helio/releases/tag/v2.0.0
[1.0.0]: https://github.com/achref-soua/helio/releases/tag/v1.0.0
[0.10.0]: https://github.com/achref-soua/helio/releases/tag/v0.10.0
[0.9.0]: https://github.com/achref-soua/helio/releases/tag/v0.9.0
[0.8.0]: https://github.com/achref-soua/helio/releases/tag/v0.8.0
[0.7.0]: https://github.com/achref-soua/helio/releases/tag/v0.7.0
[0.6.0]: https://github.com/achref-soua/helio/releases/tag/v0.6.0
[0.5.0]: https://github.com/achref-soua/helio/releases/tag/v0.5.0
[0.4.0]: https://github.com/achref-soua/helio/releases/tag/v0.4.0
[0.3.0]: https://github.com/achref-soua/helio/releases/tag/v0.3.0
[0.2.0]: https://github.com/achref-soua/helio/releases/tag/v0.2.0
[0.1.0]: https://github.com/achref-soua/helio/releases/tag/v0.1.0
