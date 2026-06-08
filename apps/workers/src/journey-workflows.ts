import {
  type JourneyDefinition,
  journeyDefinitionSchema,
  journeyNodeById,
  nextNodeId,
} from '@helio/core';
import { ApplicationFailure, proxyActivities, sleep } from '@temporalio/workflow';

import type { JourneyActivities } from './journey-activities';

const activities = proxyActivities<JourneyActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5 },
});

export interface JourneyRunInput {
  journeyId: string;
  runId: string;
  contactId: string;
}

/**
 * One contact's pass through a journey DAG (ADR-0012). Waits are
 * durable timers — a multi-week journey survives any number of worker
 * restarts; the walk itself is deterministic over the stored graph.
 */
export async function journeyRunWorkflow(input: JourneyRunInput): Promise<{ steps: number }> {
  try {
    const loaded = await activities.loadJourney(input.journeyId);
    const definition: JourneyDefinition = journeyDefinitionSchema.parse(loaded.definition);

    let steps = 0;
    let currentId: string | null = definition.startNodeId;
    while (currentId !== null) {
      const node = journeyNodeById(definition, currentId);
      if (!node) break;
      steps += 1;

      switch (node.type) {
        case 'send_email':
          await activities.sendJourneyEmail(input.journeyId, input.contactId, node.templateId);
          currentId = nextNodeId(definition, node.id);
          break;
        case 'wait':
          await sleep(node.seconds * 1000);
          currentId = nextNodeId(definition, node.id);
          break;
        case 'branch': {
          const matched = await activities.evaluateCondition(input.contactId, node.condition);
          currentId = nextNodeId(definition, node.id, matched ? 'yes' : 'no');
          break;
        }
        case 'end':
          currentId = null;
          break;
      }
    }

    await activities.completeRun(input.runId);
    return { steps };
  } catch (error) {
    const message = rootMessage(error) ?? 'journey run failed';
    await activities.failRun(input.runId, message);
    throw ApplicationFailure.nonRetryable(message, 'JourneyRunFailed');
  }
}

function rootMessage(error: unknown): string | null {
  let current: unknown = error;
  while (current instanceof Error && current.cause instanceof Error) {
    current = current.cause;
  }
  return current instanceof Error ? current.message : null;
}
