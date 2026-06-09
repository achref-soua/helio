import { SENDS_TASK_QUEUE } from '@helio/core';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WebhookActivities, WebhookDeliveryInput } from '../src/webhook-activities';
import { webhookDeliveryWorkflow } from '../src/workflows';

const workflowsPath = new URL('../src/workflows.ts', import.meta.url).pathname;

const input: WebhookDeliveryInput = {
  endpointId: 'whe_1',
  url: 'https://example.test/hook',
  secret: 'whsec_test',
  eventId: 'evt_1',
  eventType: 'deal.won',
  occurredAt: '2026-01-01T00:00:00.000Z',
  data: { id: 'deal_1', title: 'Acme renewal' },
};

describe('webhookDeliveryWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(activities: WebhookActivities) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: SENDS_TASK_QUEUE,
      workflowsPath,
      activities,
    });
    return worker.runUntil(
      env.client.workflow.execute(webhookDeliveryWorkflow, {
        taskQueue: SENDS_TASK_QUEUE,
        workflowId: `wf-${Date.now()}-${Math.random()}`,
        args: [input],
      }),
    );
  }

  it('delivers the event to the endpoint', async () => {
    const deliverWebhookEvent = vi.fn(async () => {});
    await run({ deliverWebhookEvent });
    expect(deliverWebhookEvent).toHaveBeenCalledTimes(1);
    expect(deliverWebhookEvent).toHaveBeenCalledWith(input);
  });

  it('retries until the endpoint accepts it', async () => {
    let attempts = 0;
    const deliverWebhookEvent = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('endpoint answered 503');
    });
    await run({ deliverWebhookEvent });
    expect(deliverWebhookEvent).toHaveBeenCalledTimes(3);
  });
});
