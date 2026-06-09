import {
  funnelInputSchema,
  funnelReport,
  funnelStepCounts,
  retentionInputSchema,
  retentionMatrix,
} from '@helio/core';
import { z } from 'zod';

import { getClickHouse } from '@/lib/clickhouse';

import { orgProcedure, router } from '../init';

interface DailyRow {
  day: string;
  type: string;
  count: string;
}

interface FunnelLevelRow {
  level: string;
  people: string;
}

interface RetentionCellRow {
  cohort: string;
  period: string;
  people: string;
}

interface CampaignEngagementRow {
  campaign_id: string;
  variant: string;
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
              JSONExtractString(properties, 'variant') AS variant,
              countIf(event = 'Email Opened') AS opens,
              uniqIf(JSONExtractString(properties, 'sendId'), event = 'Email Opened') AS unique_opens,
              countIf(event = 'Email Link Clicked') AS clicks
            FROM events
            WHERE workspace_id = {workspaceId:String}
              AND event IN ('Email Opened', 'Email Link Clicked')
              AND campaign_id != ''
            GROUP BY campaign_id, variant`,
          query_params: { workspaceId: input.workspaceId },
          format: 'JSONEachRow',
        });
        const rows = (await result.json()) as CampaignEngagementRow[];
        const byCampaign: Record<
          string,
          {
            opens: number;
            uniqueOpens: number;
            clicks: number;
            variants: Record<string, { uniqueOpens: number; clicks: number }>;
          }
        > = {};
        for (const row of rows) {
          const entry = (byCampaign[row.campaign_id] ??= {
            opens: 0,
            uniqueOpens: 0,
            clicks: 0,
            variants: {},
          });
          entry.opens += Number(row.opens);
          entry.uniqueOpens += Number(row.unique_opens);
          entry.clicks += Number(row.clicks);
          if (row.variant) {
            entry.variants[row.variant] = {
              uniqueOpens: Number(row.unique_opens),
              clicks: Number(row.clicks),
            };
          }
        }
        return { clickhouseUp: true, byCampaign };
      } catch {
        return { clickhouseUp: false, byCampaign: {} };
      }
    }),

  /**
   * Ordered-event funnel via ClickHouse `windowFunnel`: how many people
   * completed each step, in sequence, within the conversion window. Person
   * identity coalesces user_id then anonymous_id.
   */
  funnel: orgProcedure.input(funnelInputSchema).query(async ({ input }) => {
    const stepParams = Object.fromEntries(input.steps.map((step, index) => [`s${index}`, step]));
    const conditions = input.steps.map((_, index) => `event = {s${index}:String}`).join(', ');
    const inList = input.steps.map((_, index) => `{s${index}:String}`).join(', ');
    try {
      const result = await getClickHouse().query({
        query: `
          SELECT level, count() AS people FROM (
            SELECT windowFunnel({window:UInt32})(timestamp, ${conditions}) AS level
            FROM events
            WHERE workspace_id = {workspaceId:String}
              AND event IN (${inList})
              AND timestamp >= now() - INTERVAL {days:UInt16} DAY
            GROUP BY if(user_id != '', user_id, anonymous_id)
          )
          WHERE level > 0
          GROUP BY level ORDER BY level`,
        query_params: {
          workspaceId: input.workspaceId,
          window: input.windowDays * 86_400,
          days: input.windowDays,
          ...stepParams,
        },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as FunnelLevelRow[];
      const levels = rows.map((row) => ({ level: Number(row.level), people: Number(row.people) }));
      const reached = funnelStepCounts(levels, input.steps.length);
      return { clickhouseUp: true, steps: funnelReport(input.steps, reached) };
    } catch {
      return { clickhouseUp: false, steps: funnelReport(input.steps, []) };
    }
  }),

  /**
   * Weekly cohort retention: group people by the week first seen, then the
   * share still active at each later week. Distinct (person, week) first, so a
   * busy week counts once.
   */
  retention: orgProcedure.input(retentionInputSchema).query(async ({ input }) => {
    try {
      const result = await getClickHouse().query({
        query: `
          SELECT toDate(first_week) AS cohort,
                 dateDiff('week', first_week, active_week) AS period,
                 count(DISTINCT person) AS people
          FROM (
            SELECT person, active_week, min(active_week) OVER (PARTITION BY person) AS first_week
            FROM (
              SELECT DISTINCT
                if(user_id != '', user_id, anonymous_id) AS person,
                toStartOfWeek(timestamp) AS active_week
              FROM events
              WHERE workspace_id = {workspaceId:String}
                AND timestamp >= now() - INTERVAL {weeks:UInt16} WEEK
            )
          )
          GROUP BY cohort, period ORDER BY cohort, period`,
        query_params: { workspaceId: input.workspaceId, weeks: input.weeks },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as RetentionCellRow[];
      const cells = rows.map((row) => ({
        cohort: row.cohort,
        period: Number(row.period),
        people: Number(row.people),
      }));
      return { clickhouseUp: true, cohorts: retentionMatrix(cells, input.weeks) };
    } catch {
      return { clickhouseUp: false, cohorts: [] };
    }
  }),
});
