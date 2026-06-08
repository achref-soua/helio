import { z } from 'zod';

import { getClickHouse } from '@/lib/clickhouse';

import { orgProcedure, router } from '../init';

interface DailyRow {
  day: string;
  type: string;
  count: string;
}

interface CampaignEngagementRow {
  campaign_id: string;
  opens: string;
  unique_opens: string;
  clicks: string;
}

/**
 * Analytics over the ClickHouse event store. The core compose profile
 * has no ClickHouse, so every query degrades to "no data" — pages must
 * stay usable; freshness arrives with the full stack.
 */
export const analyticsRouter = router({
  overview: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        days: z.number().int().min(1).max(90).default(14),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [contacts, activeJourneys, sends] = await Promise.all([
        ctx.tenantDb.contact.count({ where: { workspaceId: input.workspaceId } }),
        ctx.tenantDb.journey.count({
          where: { workspaceId: input.workspaceId, status: 'ACTIVE' },
        }),
        ctx.tenantDb.emailSend.count({
          where: {
            workspaceId: input.workspaceId,
            status: 'SENT',
            sentAt: { gte: new Date(Date.now() - input.days * 86_400_000) },
          },
        }),
      ]);

      let opens = 0;
      let clicks = 0;
      let timeline: Array<{ day: string; events: number; opens: number; clicks: number }> = [];
      let clickhouseUp = true;
      try {
        const result = await getClickHouse().query({
          query: `
            SELECT toDate(timestamp) AS day, event AS type, count() AS count
            FROM events
            WHERE workspace_id = {workspaceId:String}
              AND timestamp >= now() - INTERVAL {days:UInt16} DAY
            GROUP BY day, type
            ORDER BY day`,
          query_params: { workspaceId: input.workspaceId, days: input.days },
          format: 'JSONEachRow',
        });
        const rows = (await result.json()) as DailyRow[];
        const byDay = new Map<string, { events: number; opens: number; clicks: number }>();
        for (const row of rows) {
          const entry = byDay.get(row.day) ?? { events: 0, opens: 0, clicks: 0 };
          const count = Number(row.count);
          entry.events += count;
          if (row.type === 'Email Opened') {
            entry.opens += count;
            opens += count;
          } else if (row.type === 'Email Link Clicked') {
            entry.clicks += count;
            clicks += count;
          }
          byDay.set(row.day, entry);
        }
        timeline = [...byDay.entries()]
          .map(([day, entry]) => ({ day, ...entry }))
          .sort((a, b) => a.day.localeCompare(b.day));
      } catch {
        clickhouseUp = false;
      }

      return { contacts, activeJourneys, sends, opens, clicks, timeline, clickhouseUp };
    }),

  /** Open/click engagement per campaign, for the campaign cards. */
  campaignEngagement: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const result = await getClickHouse().query({
          query: `
            SELECT
              JSONExtractString(properties, 'campaignId') AS campaign_id,
              countIf(event = 'Email Opened') AS opens,
              uniqIf(JSONExtractString(properties, 'sendId'), event = 'Email Opened') AS unique_opens,
              countIf(event = 'Email Link Clicked') AS clicks
            FROM events
            WHERE workspace_id = {workspaceId:String}
              AND event IN ('Email Opened', 'Email Link Clicked')
              AND campaign_id != ''
            GROUP BY campaign_id`,
          query_params: { workspaceId: input.workspaceId },
          format: 'JSONEachRow',
        });
        const rows = (await result.json()) as CampaignEngagementRow[];
        return {
          clickhouseUp: true,
          byCampaign: Object.fromEntries(
            rows.map((row) => [
              row.campaign_id,
              {
                opens: Number(row.opens),
                uniqueOpens: Number(row.unique_opens),
                clicks: Number(row.clicks),
              },
            ]),
          ),
        };
      } catch {
        return { clickhouseUp: false, byCampaign: {} };
      }
    }),
});
