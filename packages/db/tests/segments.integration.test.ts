import { execSync } from 'node:child_process';
import path from 'node:path';

import {
  eventConditionKey,
  extractEventConditions,
  newId,
  type SegmentRule,
  segmentRuleSchema,
} from '@helio/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compileSegmentRule, createPrismaClient, forTenant, type PrismaClient } from '../src/index';

/**
 * The compiler's contract is its behavior against real Postgres JSON +
 * citext-style semantics — unit-testing the emitted object shape would
 * only restate the implementation.
 */
describe('segment rule compilation against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let admin: PrismaClient;
  let app: PrismaClient;

  const orgId = newId('org');
  const wsId = newId('ws');

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_segments_test')
      .start();
    const adminUrl = container.getConnectionUri();
    execSync('pnpm exec prisma migrate deploy', {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
      stdio: 'pipe',
    });
    admin = createPrismaClient(adminUrl);
    const appUrl = new URL(adminUrl);
    appUrl.username = 'helio_app';
    appUrl.password = 'helio_app';
    app = createPrismaClient(appUrl.toString());

    await admin.organization.create({ data: { id: orgId, name: 'S', slug: 'seg' } });
    await admin.workspace.create({
      data: { id: wsId, organizationId: orgId, name: 'S', slug: 'main' },
    });
    await admin.contact.createMany({
      data: [
        {
          id: newId('contact'),
          organizationId: orgId,
          workspaceId: wsId,
          email: 'ada@acme.com',
          firstName: 'Ada',
          attributes: { plan: 'pro', company: 'Acme' },
        },
        {
          id: newId('contact'),
          organizationId: orgId,
          workspaceId: wsId,
          email: 'grace@acme.com',
          firstName: 'Grace',
          attributes: { plan: 'trial' },
        },
        {
          id: newId('contact'),
          organizationId: orgId,
          workspaceId: wsId,
          email: 'alan@other.org',
          firstName: null,
          status: 'UNSUBSCRIBED',
          attributes: {},
          createdAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await app?.$disconnect();
    await container?.stop();
  });

  async function emailsMatching(rule: unknown): Promise<string[]> {
    const parsed = segmentRuleSchema.parse(rule) as SegmentRule;
    const rows = await forTenant(app, orgId).contact.findMany({
      where: { AND: [{ workspaceId: wsId }, compileSegmentRule(parsed)] },
      orderBy: { email: 'asc' },
    });
    return rows.map((row) => row.email);
  }

  it('matches case-insensitive field conditions', async () => {
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'field',
            field: 'email',
            operator: 'ends_with',
            value: '@ACME.com',
          },
        ],
      }),
    ).toEqual(['ada@acme.com', 'grace@acme.com']);
  });

  it('treats NULL fields as "not equal" and "not set"', async () => {
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'field',
            field: 'firstName',
            operator: 'not_equals',
            value: 'Ada',
          },
        ],
      }),
    ).toEqual(['alan@other.org', 'grace@acme.com']);
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'condition', target: 'field', field: 'firstName', operator: 'is_not_set' },
        ],
      }),
    ).toEqual(['alan@other.org']);
  });

  it('filters JSON attributes: equals, is_set, missing keys as not_equals', async () => {
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'condition', target: 'attribute', key: 'plan', operator: 'equals', value: 'pro' },
        ],
      }),
    ).toEqual(['ada@acme.com']);

    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [{ kind: 'condition', target: 'attribute', key: 'plan', operator: 'is_set' }],
      }),
    ).toEqual(['ada@acme.com', 'grace@acme.com']);

    // Contacts without the key at all count as "not equals".
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'attribute',
            key: 'plan',
            operator: 'not_equals',
            value: 'pro',
          },
        ],
      }),
    ).toEqual(['alan@other.org', 'grace@acme.com']);
  });

  it('combines nested AND/OR groups', async () => {
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'or',
        children: [
          { kind: 'condition', target: 'status', operator: 'equals', value: 'UNSUBSCRIBED' },
          {
            kind: 'group',
            op: 'and',
            children: [
              { kind: 'condition', target: 'attribute', key: 'plan', operator: 'is_set' },
              {
                kind: 'condition',
                target: 'field',
                field: 'firstName',
                operator: 'equals',
                value: 'ada',
              },
            ],
          },
        ],
      }),
    ).toEqual(['ada@acme.com', 'alan@other.org']);
  });

  it('filters by creation window', async () => {
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'created_at',
            operator: 'before',
            value: '2021-01-01T00:00:00Z',
          },
        ],
      }),
    ).toEqual(['alan@other.org']);
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'condition', target: 'created_at', operator: 'in_last_days', value: 30 },
        ],
      }),
    ).toEqual(['ada@acme.com', 'grace@acme.com']);
  });

  it('covers the remaining operators', async () => {
    const single = (children: unknown[]) => ({ kind: 'group', op: 'and', children });

    // Field string operators.
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'field',
            field: 'firstName',
            operator: 'starts_with',
            value: 'gr',
          },
        ]),
      ),
    ).toEqual(['grace@acme.com']);
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'field',
            field: 'email',
            operator: 'equals',
            value: 'ADA@acme.com',
          },
        ]),
      ),
    ).toEqual(['ada@acme.com']);
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'field',
            field: 'email',
            operator: 'not_contains',
            value: '@acme.com',
          },
        ]),
      ),
    ).toEqual(['alan@other.org']);
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'field',
            field: 'firstName',
            operator: 'not_contains',
            value: 'a',
          },
        ]),
      ),
    ).toEqual(['alan@other.org']); // NULL name counts as not-containing
    expect(
      await emailsMatching(
        single([{ kind: 'condition', target: 'field', field: 'firstName', operator: 'is_set' }]),
      ),
    ).toEqual(['ada@acme.com', 'grace@acme.com']);
    expect(
      await emailsMatching(
        single([{ kind: 'condition', target: 'field', field: 'email', operator: 'is_not_set' }]),
      ),
    ).toEqual([]); // email is mandatory: nothing matches
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'field',
            field: 'email',
            operator: 'not_equals',
            value: 'ada@acme.com',
          },
        ]),
      ),
    ).toEqual(['alan@other.org', 'grace@acme.com']);

    // Attribute string operators.
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'attribute',
            key: 'company',
            operator: 'contains',
            value: 'cme',
          },
        ]),
      ),
    ).toEqual(['ada@acme.com']);
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'attribute',
            key: 'plan',
            operator: 'starts_with',
            value: 'tri',
          },
        ]),
      ),
    ).toEqual(['grace@acme.com']);
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'attribute',
            key: 'plan',
            operator: 'ends_with',
            value: 'ial',
          },
        ]),
      ),
    ).toEqual(['grace@acme.com']);
    // not_contains only matches contacts that HAVE the key.
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'attribute',
            key: 'plan',
            operator: 'not_contains',
            value: 'pro',
          },
        ]),
      ),
    ).toEqual(['grace@acme.com']);
    expect(
      await emailsMatching(
        single([{ kind: 'condition', target: 'attribute', key: 'plan', operator: 'is_not_set' }]),
      ),
    ).toEqual(['alan@other.org']);

    // Status + created_at remaining operators.
    expect(
      await emailsMatching(
        single([
          { kind: 'condition', target: 'status', operator: 'not_equals', value: 'UNSUBSCRIBED' },
        ]),
      ),
    ).toEqual(['ada@acme.com', 'grace@acme.com']);
    expect(
      await emailsMatching(
        single([
          {
            kind: 'condition',
            target: 'created_at',
            operator: 'after',
            value: '2021-01-01T00:00:00Z',
          },
        ]),
      ),
    ).toEqual(['ada@acme.com', 'grace@acme.com']);
  });

  it('filters by score', async () => {
    await admin.contact.updateMany({
      where: { workspaceId: wsId, email: 'ada@acme.com' },
      data: { score: 42 },
    });
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [{ kind: 'condition', target: 'score', operator: 'gte', value: 40 }],
      }),
    ).toEqual(['ada@acme.com']);
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [{ kind: 'condition', target: 'score', operator: 'lte', value: 0 }],
      }),
    ).toEqual(['alan@other.org', 'grace@acme.com']);
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [{ kind: 'condition', target: 'score', operator: 'equals', value: 42 }],
      }),
    ).toEqual(['ada@acme.com']);
  });

  it('filters by AI predictions, excluding un-scored (null) contacts', async () => {
    await admin.contact.updateMany({
      where: { workspaceId: wsId, email: 'ada@acme.com' },
      data: { churnRisk: 0.9, conversionProbability: 0.2 },
    });
    await admin.contact.updateMany({
      where: { workspaceId: wsId, email: 'grace@acme.com' },
      data: { churnRisk: 0.1, conversionProbability: 0.8 },
    });
    // High churn risk: only ada (grace is low; alan is null and excluded).
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'prediction',
            metric: 'churnRisk',
            operator: 'gte',
            value: 0.5,
          },
        ],
      }),
    ).toEqual(['ada@acme.com']);
    // High conversion propensity: only grace.
    expect(
      await emailsMatching({
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'prediction',
            metric: 'conversionProbability',
            operator: 'gte',
            value: 0.5,
          },
        ],
      }),
    ).toEqual(['grace@acme.com']);
  });

  it('isolates segments by tenant (RLS)', async () => {
    const otherOrg = newId('org');
    await admin.organization.create({ data: { id: otherOrg, name: 'X', slug: 'seg-x' } });
    const tenantX = forTenant(app, otherOrg);
    expect(await tenantX.segment.findMany()).toEqual([]);
    await expect(
      tenantX.segment.create({
        data: {
          id: newId('seg'),
          organizationId: orgId, // forged cross-tenant write
          workspaceId: wsId,
          name: 'Forged',
          rule: { kind: 'group', op: 'and', children: [] },
        },
      }),
    ).rejects.toThrowError();
  });

  describe('behavioral conditions with resolved sets', () => {
    it('applies in/notIn email sets and refuses unresolved rules', async () => {
      const rule = segmentRuleSchema.parse({
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            target: 'event',
            event: 'Opened',
            operator: 'at_least',
            count: 1,
            inLastDays: 30,
          },
        ],
      });
      const key = eventConditionKey(extractEventConditions(rule)[0]!);

      const inSet = new Map([[key, { mode: 'in' as const, emails: ['ada@acme.com'] }]]);
      const matchedIn = await forTenant(app, orgId).contact.findMany({
        where: { AND: [{ workspaceId: wsId }, compileSegmentRule(rule, inSet)] },
      });
      expect(matchedIn.map((c) => c.email)).toEqual(['ada@acme.com']);

      const notInSet = new Map([[key, { mode: 'notIn' as const, emails: ['ada@acme.com'] }]]);
      const matchedNotIn = await forTenant(app, orgId).contact.findMany({
        where: { AND: [{ workspaceId: wsId }, compileSegmentRule(rule, notInSet)] },
        orderBy: { email: 'asc' },
      });
      expect(matchedNotIn.map((c) => c.email)).toEqual(['alan@other.org', 'grace@acme.com']);

      expect(() => compileSegmentRule(rule)).toThrowError(/resolve them against the event store/);
    });
  });
});
