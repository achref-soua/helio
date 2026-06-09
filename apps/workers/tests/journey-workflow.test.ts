import { SENDS_TASK_QUEUE } from '@helio/core';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { JourneyActivities } from '../src/journey-activities';
import { journeyRunWorkflow } from '../src/journey-workflows';

const workflowsPath = new URL('../src/workflows.ts', import.meta.url).pathname;

const DEFINITION = {
  trigger: { type: 'event', event: 'Signed Up' },
  startNodeId: 'welcome',
  nodes: [
    { id: 'welcome', type: 'send_email', templateId: 'tpl_welcome' },
    { id: 'soak', type: 'wait', seconds: 7 * 24 * 60 * 60 }, // one week
    {
      id: 'is_pro',
      type: 'branch',
      condition: {
        kind: 'condition',
        target: 'attribute',
        key: 'plan',
        operator: 'equals',
        value: 'pro',
      },
    },
    { id: 'upsell', type: 'send_email', templateId: 'tpl_upsell' },
    { id: 'done', type: 'end' },
  ],
  edges: [
    { from: 'welcome', to: 'soak' },
    { from: 'soak', to: 'is_pro' },
    { from: 'is_pro', to: 'done', label: 'yes' },
    { from: 'is_pro', to: 'upsell', label: 'no' },
    { from: 'upsell', to: 'done' },
  ],
};

describe('journeyRunWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(activities: JourneyActivities) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: SENDS_TASK_QUEUE,
      workflowsPath,
      activities,
    });
    return worker.runUntil(
      env.client.workflow.execute(journeyRunWorkflow, {
        taskQueue: SENDS_TASK_QUEUE,
        workflowId: `jr-${Date.now()}-${Math.random()}`,
        args: [{ journeyId: 'jny_1', runId: 'run_1', contactId: 'contact_1' }],
      }),
    );
  }

  function makeActivities(overrides: Partial<JourneyActivities> = {}): JourneyActivities {
    return {
      loadJourney: vi.fn(async () => ({
        organizationId: 'org',
        workspaceId: 'ws',
        definition: DEFINITION,
      })),
      sendJourneyEmail: vi.fn(async () => ({ sent: true })),
      evaluateCondition: vi.fn(async () => false),
      sendGate: vi.fn(async () => 0),
      applyTrait: vi.fn(async () => {}),
      callWebhook: vi.fn(async () => {}),
      contactEmail: vi.fn(async () => 'x@example.com'),
      completeRun: vi.fn(async () => {}),
      failRun: vi.fn(async () => {}),
      ...overrides,
    } as JourneyActivities;
  }

  it('walks send → wait (a week, time-skipped) → branch no → send → end', async () => {
    const activities = makeActivities();
    const startedAt = Date.now();
    const result = await run(activities);
    // Wall-clock proof the one-week timer was skipped, not slept.
    expect(Date.now() - startedAt).toBeLessThan(30_000);

    expect(result).toEqual({ steps: 5 });
    expect(activities.sendJourneyEmail).toHaveBeenNthCalledWith(
      1,
      'jny_1',
      'contact_1',
      'tpl_welcome',
    );
    expect(activities.sendJourneyEmail).toHaveBeenNthCalledWith(
      2,
      'jny_1',
      'contact_1',
      'tpl_upsell',
    );
    expect(activities.evaluateCondition).toHaveBeenCalledTimes(1);
    expect(activities.completeRun).toHaveBeenCalledWith('run_1');
    expect(activities.failRun).not.toHaveBeenCalled();
  });

  it('takes the yes edge straight to the end', async () => {
    const activities = makeActivities({ evaluateCondition: vi.fn(async () => true) });
    const result = await run(activities);
    expect(result).toEqual({ steps: 4 }); // welcome, soak, branch, end
    expect(activities.sendJourneyEmail).toHaveBeenCalledTimes(1);
  });

  it('marks the run failed when a send keeps failing', async () => {
    const activities = makeActivities({
      sendJourneyEmail: vi.fn(async () => {
        throw new Error('relay rejected');
      }),
    });
    await expect(run(activities)).rejects.toThrowError();
    expect(activities.failRun).toHaveBeenCalledWith(
      'run_1',
      expect.stringContaining('relay rejected'),
    );
    expect(activities.completeRun).not.toHaveBeenCalled();
  });

  it('rejects invalid stored definitions without executing nodes', async () => {
    const activities = makeActivities({
      loadJourney: vi.fn(async () => ({
        organizationId: 'org',
        workspaceId: 'ws',
        definition: {
          trigger: { type: 'event', event: 'x' },
          startNodeId: 'ghost',
          nodes: [],
          edges: [],
        },
      })),
    });
    await expect(run(activities)).rejects.toThrowError();
    expect(activities.sendJourneyEmail).not.toHaveBeenCalled();
    expect(activities.failRun).toHaveBeenCalled();
  });
});

describe('journeyRunWorkflow v2 nodes', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  const V2 = {
    trigger: { type: 'event', event: 'Signed Up' },
    startNodeId: 'split',
    nodes: [
      { id: 'split', type: 'ab_split', ratioA: 50 },
      { id: 'mark_a', type: 'update_trait', key: 'variant', value: 'a' },
      { id: 'mark_b', type: 'update_trait', key: 'variant', value: 'b' },
      { id: 'notify', type: 'webhook', url: 'https://hooks.example.test/done' },
      { id: 'mail', type: 'send_email', templateId: 'tpl_1' },
      { id: 'fin', type: 'end' },
    ],
    edges: [
      { from: 'split', to: 'mark_a', label: 'a' },
      { from: 'split', to: 'mark_b', label: 'b' },
      { from: 'mark_a', to: 'notify' },
      { from: 'mark_b', to: 'notify' },
      { from: 'notify', to: 'mail' },
      { from: 'mail', to: 'fin' },
    ],
    quietHours: { start: '21:00', end: '08:00', timezone: 'UTC' },
    frequencyCap: { maxEmails: 3, perDays: 7 },
  };

  function makeV2Activities(overrides: Partial<JourneyActivities> = {}): JourneyActivities {
    return {
      loadJourney: vi.fn(async () => ({
        organizationId: 'org',
        workspaceId: 'ws',
        definition: V2,
      })),
      sendJourneyEmail: vi.fn(async () => ({ sent: true })),
      evaluateCondition: vi.fn(async () => false),
      sendGate: vi.fn(async () => 0),
      applyTrait: vi.fn(async () => {}),
      callWebhook: vi.fn(async () => {}),
      contactEmail: vi.fn(async () => 'ada@example.com'),
      completeRun: vi.fn(async () => {}),
      failRun: vi.fn(async () => {}),
      ...overrides,
    } as JourneyActivities;
  }

  async function runV2(activities: JourneyActivities) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: SENDS_TASK_QUEUE,
      workflowsPath,
      activities,
    });
    return worker.runUntil(
      env.client.workflow.execute(journeyRunWorkflow, {
        taskQueue: SENDS_TASK_QUEUE,
        workflowId: `jr2-${Date.now()}-${Math.random()}`,
        args: [{ journeyId: 'jny_2', runId: 'run_2', contactId: 'contact_2' }],
      }),
    );
  }

  it('splits, marks the variant, webhooks, gates, and sends', async () => {
    const activities = makeV2Activities();
    const result = await runV2(activities);
    expect(result.steps).toBe(5); // split, mark, notify, mail, end

    // Exactly one variant trait applied with the matching edge value.
    expect(activities.applyTrait).toHaveBeenCalledTimes(1);
    const [, key, value] = (activities.applyTrait as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe('variant');
    expect(['a', 'b']).toContain(value);

    expect(activities.callWebhook).toHaveBeenCalledWith('https://hooks.example.test/done', {
      journeyId: 'jny_2',
      contactId: 'contact_2',
      email: 'ada@example.com',
    });
    expect(activities.sendGate).toHaveBeenCalledWith(
      'contact_2',
      V2.quietHours,
      V2.frequencyCap,
      false,
    );
    expect(activities.sendJourneyEmail).toHaveBeenCalledTimes(1);
  });

  it('texts the contact at a send_sms node', async () => {
    const smsDefinition = {
      trigger: { type: 'event', event: 'Signed Up' },
      startNodeId: 'sms',
      nodes: [
        { id: 'sms', type: 'send_sms', body: 'Hi {{firstName}}' },
        { id: 'fin', type: 'end' },
      ],
      edges: [{ from: 'sms', to: 'fin' }],
    };
    const sendJourneySms = vi.fn(async () => ({ sent: 1 }));
    const activities = makeV2Activities({
      loadJourney: vi.fn(async () => ({
        organizationId: 'org',
        workspaceId: 'ws',
        definition: smsDefinition,
      })),
      sendJourneySms,
    } as Partial<JourneyActivities>);
    await runV2(activities);
    expect(sendJourneySms).toHaveBeenCalledWith('contact_2', 'Hi {{firstName}}');
  });

  it('messages the contact at a send_whatsapp node', async () => {
    const whatsappDefinition = {
      trigger: { type: 'event', event: 'Signed Up' },
      startNodeId: 'wa',
      nodes: [
        { id: 'wa', type: 'send_whatsapp', body: 'Hi {{firstName}}' },
        { id: 'fin', type: 'end' },
      ],
      edges: [{ from: 'wa', to: 'fin' }],
    };
    const sendJourneyWhatsApp = vi.fn(async () => ({ sent: 1 }));
    const activities = makeV2Activities({
      loadJourney: vi.fn(async () => ({
        organizationId: 'org',
        workspaceId: 'ws',
        definition: whatsappDefinition,
      })),
      sendJourneyWhatsApp,
    } as Partial<JourneyActivities>);
    await runV2(activities);
    expect(sendJourneyWhatsApp).toHaveBeenCalledWith('contact_2', 'Hi {{firstName}}');
  });

  it('defers the send while quiet hours are active (time-skipped)', async () => {
    const activities = makeV2Activities({
      sendGate: vi.fn(async () => 6 * 60 * 60 * 1000), // six-hour quiet window
    });
    const startedAt = Date.now();
    await runV2(activities);
    expect(Date.now() - startedAt).toBeLessThan(30_000); // skipped, not slept
    expect(activities.sendJourneyEmail).toHaveBeenCalledTimes(1);
  });

  it('skips the send entirely when the frequency cap is hit', async () => {
    const activities = makeV2Activities({ sendGate: vi.fn(async () => -1) });
    const result = await runV2(activities);
    expect(activities.sendJourneyEmail).not.toHaveBeenCalled();
    expect(activities.completeRun).toHaveBeenCalled(); // run still completes
    expect(result.steps).toBe(5);
  });
});
