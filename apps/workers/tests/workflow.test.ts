import { isInAbTestSample, SENDS_TASK_QUEUE } from '@helio/core';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CampaignActivities } from '../src/activities';
import { campaignSendWorkflow } from '../src/workflows';

const workflowsPath = new URL('../src/workflows.ts', import.meta.url).pathname;

describe('campaignSendWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(activities: CampaignActivities) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: SENDS_TASK_QUEUE,
      workflowsPath,
      activities,
    });
    return worker.runUntil(
      env.client.workflow.execute(campaignSendWorkflow, {
        taskQueue: SENDS_TASK_QUEUE,
        workflowId: `wf-${Date.now()}-${Math.random()}`,
        args: [{ campaignId: 'cmp_1' }],
      }),
    );
  }

  it('pages through the audience, sends every batch, and completes', async () => {
    const pages = [
      { contactIds: ['c1', 'c2'], nextCursor: 'c2' },
      { contactIds: ['c3'], nextCursor: null },
    ];
    const listRecipients = vi.fn(async (_id: string, cursor: string | null) =>
      cursor === null ? pages[0]! : pages[1]!,
    );
    const sendToContacts = vi.fn(async (_id: string, ids: string[]) => ({
      sent: ids.length,
      failed: 0,
      skipped: 0,
    }));
    const completeCampaign = vi.fn(async () => {});
    const activities = {
      startCampaign: vi.fn(async () => ({ organizationId: 'org', workspaceId: 'ws' })),
      listRecipients,
      sendToContacts,
      completeCampaign,
      failCampaign: vi.fn(async () => {}),
    } as unknown as CampaignActivities;

    const result = await run(activities);
    expect(result).toEqual({ sent: 3, failed: 0, skipped: 0 });
    expect(listRecipients).toHaveBeenCalledTimes(2);
    expect(sendToContacts).toHaveBeenNthCalledWith(1, 'cmp_1', ['c1', 'c2'], undefined);
    expect(sendToContacts).toHaveBeenNthCalledWith(2, 'cmp_1', ['c3'], undefined);
    expect(completeCampaign).toHaveBeenCalledWith('cmp_1', 0);
  });

  it('auto-winner: tests a slice, waits, decides, then promotes to the holdout', async () => {
    const allIds = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const percent = 50;
    const testIds = allIds.filter((id) => isInAbTestSample(id, percent));
    const holdoutIds = allIds.filter((id) => !isInAbTestSample(id, percent));
    expect(testIds.length).toBeGreaterThan(0);
    expect(holdoutIds.length).toBeGreaterThan(0);

    // listRecipients is called once per pass; one page covers everyone.
    const listRecipients = vi.fn(async () => ({ contactIds: allIds, nextCursor: null }));
    const sendToContacts = vi.fn(async (_id: string, ids: string[]) => ({
      sent: ids.length,
      failed: 0,
      skipped: 0,
    }));
    const abVariantStats = vi.fn(async () => ({
      a: { sent: 3, opens: 1 },
      b: { sent: 3, opens: 2 },
    }));
    const decideAbWinner = vi.fn(async () => 'b' as const);
    const activities = {
      startCampaign: vi.fn(async () => ({
        organizationId: 'org',
        workspaceId: 'ws',
        abAutoWinner: true,
        hasVariantB: true,
        abTestPercent: percent,
        abTestWindowSeconds: 3600,
      })),
      listRecipients,
      sendToContacts,
      abVariantStats,
      decideAbWinner,
      completeCampaign: vi.fn(async () => {}),
      failCampaign: vi.fn(async () => {}),
    } as unknown as CampaignActivities;

    const result = await run(activities);

    // Everyone got exactly one email across the two passes.
    expect(result.sent).toBe(allIds.length);
    // Test pass: the slice, no forced variant (random a/b).
    expect(sendToContacts).toHaveBeenNthCalledWith(1, 'cmp_1', testIds, undefined);
    // Decision happened on the gathered stats…
    expect(abVariantStats).toHaveBeenCalledWith('cmp_1');
    expect(decideAbWinner).toHaveBeenCalledWith('cmp_1', {
      a: { sent: 3, opens: 1 },
      b: { sent: 3, opens: 2 },
    });
    // …and the holdout got the winning subject 'b'.
    expect(sendToContacts).toHaveBeenNthCalledWith(2, 'cmp_1', holdoutIds, 'b');
  });

  it('aggregates failures and reports them to completeCampaign', async () => {
    const activities = {
      startCampaign: vi.fn(async () => ({ organizationId: 'org', workspaceId: 'ws' })),
      listRecipients: vi.fn(async () => ({ contactIds: ['c1', 'c2'], nextCursor: null })),
      sendToContacts: vi.fn(async () => ({ sent: 1, failed: 1, skipped: 0 })),
      completeCampaign: vi.fn(async () => {}),
      failCampaign: vi.fn(async () => {}),
    } as unknown as CampaignActivities;

    const result = await run(activities);
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(activities.completeCampaign).toHaveBeenCalledWith('cmp_1', 1);
  });

  it('marks the campaign failed when enumeration keeps failing', async () => {
    const activities = {
      startCampaign: vi.fn(async () => ({ organizationId: 'org', workspaceId: 'ws' })),
      listRecipients: vi.fn(async () => {
        throw new Error('audience query exploded');
      }),
      sendToContacts: vi.fn(),
      completeCampaign: vi.fn(),
      failCampaign: vi.fn(async () => {}),
    } as unknown as CampaignActivities;

    await expect(run(activities)).rejects.toThrowError();
    expect(activities.failCampaign).toHaveBeenCalledWith(
      'cmp_1',
      expect.stringContaining('audience query exploded'),
    );
    expect(activities.completeCampaign).not.toHaveBeenCalled();
  });
});
