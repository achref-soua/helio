# ADR-0011: Campaign delivery — Temporal, send rows, suppression

**Status:** accepted · 2026-06-08

## Context

Campaign sends are long-running, must survive worker crashes without
double-sending (the brief's bar), and need per-recipient bookkeeping for
analytics and deliverability. ADR-0005 fixed Temporal as the orchestrator;
this records the delivery semantics.

## Decision

**One workflow per campaign.** `campaignSendWorkflow` enumerates the
audience in cursor pages and delivers in batched activities (100/batch,
per-contact heartbeats). The Temporal workflow id is derived from the
campaign id, so re-launching an in-flight campaign dedupes server-side.

**No-double-send via send rows.** `email_send` is unique on
`(campaign_id, contact_id)`. A batch activity claims the row before
delivering; on retry, SENT rows are skipped, FAILED and QUEUED rows are
re-attempted. The only duplicate window is a crash between provider
acceptance and the SENT update — at-least-once on that edge, recorded
in the row's status either way.

**Suppression at enumeration and at claim time.** Only ACTIVE contacts
enter the pipeline (audience queries filter status), and the batch
re-checks status per contact, so an unsubscribe landing mid-campaign is
honored within a batch boundary.

**Compliance is part of rendering.** Every marketing send carries a
footer unsubscribe link and RFC 8058 one-click headers
(`List-Unsubscribe`, `List-Unsubscribe-Post`). Unsubscribe tokens are
stateless HMACs over the contact id — links in years-old emails keep
working without a token table.

**Workers use the admin connection.** Activities are a trusted backend
crossing workspaces by design; every query still re-scopes through the
campaign's own workspace id (pattern shared with ADR-0010).

## Consequences

Sending requires the full compose profile (Temporal) plus the worker
process; the dashboard degrades with an actionable error when Temporal
is unreachable. Activity-level idempotency keys (provider-side) can
tighten the remaining duplicate edge per adapter later.
