import { type EnrichedEvent, JOURNEY_RUN_WORKFLOW, newId, SENDS_TASK_QUEUE } from '@helio/core';
import type { PrismaClient } from '@helio/db';
import type { Client as TemporalClient } from '@temporalio/client';
import type { Logger } from 'pino';

export interface TriggerDeps {
  prisma: PrismaClient;
  temporal: TemporalClient;
  logger: Logger;
}

/**
 * Event → journey enrollment (ADR-0012). For every tracked event, find
 * ACTIVE journeys in the workspace whose trigger names that event,
 * resolve the contact by email (identity resolution proper is Phase 2),
 * and start one durable run unless the contact already has one running.
 */
/** Apply matching scoring rules: one atomic score bump per event. */
export async function scoreFromEvent(event: EnrichedEvent, deps: TriggerDeps): Promise<boolean> {
  if (event.type !== 'track' || !event.user_id) return false;
  const rule = await deps.prisma.scoringRule.findUnique({
    where: { workspaceId_event: { workspaceId: event.workspace_id, event: event.event } },
    select: { points: true },
  });
  if (!rule) return false;
  const updated = await deps.prisma.contact.updateMany({
    where: { workspaceId: event.workspace_id, email: event.user_id },
    data: { score: { increment: rule.points } },
  });
  return updated.count > 0;
}

export async function enrollFromEvent(event: EnrichedEvent, deps: TriggerDeps): Promise<number> {
  if (event.type !== 'track' || !event.user_id) return 0;

  const journeys = await deps.prisma.journey.findMany({
    where: {
      workspaceId: event.workspace_id,
      status: 'ACTIVE',
      definition: { path: ['trigger', 'event'], equals: event.event },
    },
    select: { id: true, organizationId: true },
  });
  if (journeys.length === 0) return 0;

  const contact = await deps.prisma.contact.findUnique({
    where: { workspaceId_email: { workspaceId: event.workspace_id, email: event.user_id } },
    select: { id: true, status: true },
  });
  if (!contact || contact.status !== 'ACTIVE') return 0;

  let started = 0;
  for (const journey of journeys) {
    const running = await deps.prisma.journeyRun.findFirst({
      where: { journeyId: journey.id, contactId: contact.id, status: 'RUNNING' },
      select: { id: true },
    });
    if (running) continue;

    const run = await deps.prisma.journeyRun.create({
      data: {
        id: newId('run'),
        organizationId: journey.organizationId,
        journeyId: journey.id,
        contactId: contact.id,
      },
    });
    try {
      await deps.temporal.workflow.start(JOURNEY_RUN_WORKFLOW, {
        taskQueue: SENDS_TASK_QUEUE,
        // Run-row id keys the workflow: redeliveries of the same event
        // cannot start a second execution for this enrollment.
        workflowId: `journey-run-${run.id}`,
        args: [{ journeyId: journey.id, runId: run.id, contactId: contact.id }],
      });
      started += 1;
    } catch (error) {
      await deps.prisma.journeyRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: 'failed to start workflow', completedAt: new Date() },
      });
      deps.logger.error({ error, journeyId: journey.id }, 'journey start failed');
    }
  }
  return started;
}
