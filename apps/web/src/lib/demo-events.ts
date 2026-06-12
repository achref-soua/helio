import type { PrismaClient } from '@helio/db';

import { getClickHouse } from '@/lib/clickhouse';

/**
 * Demo behavioral history. The Prisma seed gives the workspace contacts,
 * campaigns, and sends; this gives them a past — four weeks of pageviews,
 * funnel events, and email engagement inserted straight into ClickHouse so
 * the dashboard timeline, funnels, cohorts, attribution, and campaign
 * meters all show real shapes on a fresh full-profile install. The core
 * profile has no ClickHouse: every failure here returns 0 rows and the
 * setup wizard carries on.
 *
 * Deterministic by construction (an LCG seeded per contact), so reseeding
 * produces the same story rather than noise.
 */

const DAY_MS = 86_400_000;

function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

interface EventRow {
  organization_id: string;
  workspace_id: string;
  message_id: string;
  type: string;
  event: string;
  anonymous_id: string;
  user_id: string;
  properties: string;
  context: string;
  timestamp: string;
  received_at: string;
}

const PAGES = ['/pricing', '/docs', '/features', '/blog/launch', '/'];

function toCh(date: Date): string {
  // DateTime64(3, 'UTC') accepts 'YYYY-MM-DD HH:MM:SS.mmm'.
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export async function seedDemoEvents(
  prisma: PrismaClient,
  ws: { organizationId: string; workspaceId: string },
): Promise<number> {
  try {
    const contacts = await prisma.contact.findMany({
      where: { workspaceId: ws.workspaceId, status: 'ACTIVE' },
      select: { email: true, score: true },
      orderBy: { email: 'asc' },
    });
    if (contacts.length === 0) return 0;
    const sends = await prisma.emailSend.findMany({
      where: { workspaceId: ws.workspaceId, campaignId: { not: null } },
      select: { id: true, campaignId: true, sentAt: true, contact: { select: { email: true } } },
    });

    const now = Date.now();
    const rows: EventRow[] = [];
    const push = (
      email: string,
      index: number,
      type: string,
      event: string,
      at: Date,
      properties: Record<string, unknown> = {},
    ) => {
      rows.push({
        organization_id: ws.organizationId,
        workspace_id: ws.workspaceId,
        message_id: `demo-${email}-${event}-${index}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        type,
        event,
        anonymous_id: `anon-${email}`,
        user_id: email,
        properties: JSON.stringify(properties),
        context: JSON.stringify({ source: 'seed' }),
        timestamp: toCh(at),
        received_at: toCh(at),
      });
    };

    for (const [contactIndex, contact] of contacts.entries()) {
      const rand = lcg(contactIndex + 7);
      // Engagement scales with the seeded lead score, so high scorers
      // genuinely look more active in every chart.
      const activity = 6 + Math.round(((contact.score ?? 10) / 100) * 22);
      const firstSeen = now - Math.round((7 + rand() * 21) * DAY_MS);

      push(contact.email, 0, 'track', 'Signed Up', new Date(firstSeen));
      for (let index = 1; index <= activity; index++) {
        const at = new Date(firstSeen + rand() * (now - firstSeen));
        const roll = rand();
        if (roll < 0.55) {
          push(contact.email, index, 'page', 'Page Viewed', at, {
            path: PAGES[Math.floor(rand() * PAGES.length)],
          });
        } else if (roll < 0.75) {
          push(contact.email, index, 'track', 'Pricing Viewed', at);
        } else if (roll < 0.9) {
          push(contact.email, index, 'track', 'Added to Cart', at);
        } else {
          push(contact.email, index, 'track', 'Order Completed', at, {
            value: Math.round(20 + rand() * 180),
          });
        }
      }
    }

    // Email engagement tied to the real seeded sends, so the campaign
    // meters and attribution touch the same ids the product uses.
    for (const [sendIndex, send] of sends.entries()) {
      const email = send.contact?.email;
      if (!email || !send.sentAt || !send.campaignId) continue;
      const rand = lcg(sendIndex + 101);
      if (rand() < 0.72) {
        const openedAt = new Date(send.sentAt.getTime() + Math.round(rand() * 36) * 3_600_000);
        push(email, sendIndex, 'track', 'Email Opened', openedAt, {
          campaignId: send.campaignId,
          sendId: send.id,
        });
        if (rand() < 0.45) {
          push(
            email,
            sendIndex + 1000,
            'track',
            'Email Link Clicked',
            new Date(openedAt.getTime() + 600_000),
            {
              campaignId: send.campaignId,
              sendId: send.id,
            },
          );
        }
      }
    }

    await getClickHouse().insert({ table: 'events', values: rows, format: 'JSONEachRow' });
    return rows.length;
  } catch {
    // No ClickHouse (core profile) or table not migrated yet — the demo
    // simply has no behavioral history; nothing else depends on it.
    return 0;
  }
}
