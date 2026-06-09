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

// External endpoints get fewer retries and a tighter ceiling — a broken
// webhook should fail the run quickly, not hammer someone's server.
const webhookActivities = proxyActivities<JourneyActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
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
        case 'send_email': {
          // Quiet hours + send-time optimization defer; frequency caps
          // skip (never queue forever).
          const gate = await activities.sendGate(
            input.contactId,
            definition.quietHours ?? null,
            definition.frequencyCap ?? null,
            node.optimizeSendTime ?? false,
          );
          if (gate > 0) await sleep(gate);
          if (gate !== -1) {
            await activities.sendJourneyEmail(input.journeyId, input.contactId, node.templateId);
          }
          currentId = nextNodeId(definition, node.id);
          break;
        }
        case 'wait':
          await sleep(node.seconds * 1000);
          currentId = nextNodeId(definition, node.id);
          break;
        case 'branch': {
          const matched = await activities.evaluateCondition(input.contactId, node.condition);
          currentId = nextNodeId(definition, node.id, matched ? 'yes' : 'no');
          break;
        }
        case 'ab_split': {
          // Temporal's sandbox PRNG is recorded — replay-safe randomness.
          const toA = Math.random() * 100 < node.ratioA;
          currentId = nextNodeId(definition, node.id, toA ? 'a' : 'b');
          break;
        }
        case 'update_trait':
          await activities.applyTrait(input.contactId, node.key, node.value);
          currentId = nextNodeId(definition, node.id);
          break;
        case 'webhook': {
          const email = await activities.contactEmail(input.contactId);
          await webhookActivities.callWebhook(node.url, {
            journeyId: input.journeyId,
            contactId: input.contactId,
            email,
          });
          currentId = nextNodeId(definition, node.id);
          break;
        }
        case 'send_push':
          await activities.sendJourneyPush(input.contactId, {
            title: node.title,
            body: node.body,
            url: node.url,
          });
          currentId = nextNodeId(definition, node.id);
          break;
        case 'send_sms':
          await activities.sendJourneySms(input.contactId, node.body);
          currentId = nextNodeId(definition, node.id);
          break;
        case 'send_whatsapp':
          await activities.sendJourneyWhatsApp(input.contactId, node.body);
          currentId = nextNodeId(definition, node.id);
          break;
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
