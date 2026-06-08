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
