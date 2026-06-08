# ADR-0012: Journey execution — one workflow per enrollment

**Status:** accepted · 2026-06-08

## Context

Journeys are long-lived per-contact automations (waits of days or weeks,
branches on live contact data) that must survive restarts without losing
position or double-sending — the project's headline durability claim.

## Decision

**A journey is a validated DAG; a run is a Temporal workflow.** The
canvas saves a `journeyDefinitionSchema` document (single event trigger,
send/wait/branch/end nodes, cycle-free, branch nodes with exactly
yes/no edges). `journeyRunWorkflow` walks the stored graph: sends are
activities, waits are durable timers, branches evaluate a contact
condition through the segment compiler at decision time — so a branch
sees the contact as they are _then_, not at enrollment.

**Enrollment is a bus consumer.** A second consumer group on the events
topic matches `track` events against ACTIVE journeys' triggers
(workspace + event name), resolves the contact by email (identity
resolution proper is Phase 2), and starts one workflow per enrollment.
A RUNNING `journey_run` row is the re-entry guard; the workflow id is
derived from the run row, so event redeliveries cannot fork executions.

**Crash semantics.** Verified live: kill -9 mid-wait, let the timer
expire while no worker runs, restart — the workflow resumes from
history and completes without re-executing prior sends. Failed runs are
recorded on the run row and the workflow fails non-retryably after
bookkeeping.

## Consequences

Trigger matching reads `definition->trigger->event` per event — fine at
Phase 1 volumes; an in-memory trigger index amortizes it when event
rates demand. Journey edits don't affect in-flight runs (each run
loaded its definition at start) — explicit versioning lands in Phase 2.
