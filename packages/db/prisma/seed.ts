/* eslint-disable no-console -- seed is an operator-facing CLI script */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { newId } from '@helio/core';

import { createPrismaClient } from '../src/client';
import { seedDemoWorkspace } from '../src/seed-demo';

// Standalone script: load the repo-root .env when present.
const repoRootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (fs.existsSync(repoRootEnv)) {
  process.loadEnvFile(repoRootEnv);
}

/**
 * Seed the demo workspace. Idempotent: safe to re-run. Runs with the
 * admin connection so it can write across tenants. On an instance that
 * already has an organization (a real install after its setup wizard),
 * the sample data lands in that first organization's first workspace —
 * data nobody can see helps nobody. Only a completely fresh database
 * gets the standalone acme/growth pair (the dev quickstart). The
 * showroom content itself lives in src/seed-demo.ts, shared with the
 * demo-video and screenshot tooling.
 */
async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_ADMIN_URL or DATABASE_URL must be set to seed');
  }
  const prisma = createPrismaClient(url);

  let org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  let workspace = org
    ? await prisma.workspace.findFirst({
        where: { organizationId: org.id },
        orderBy: { createdAt: 'asc' },
      })
    : null;

  if (!org || !workspace) {
    org = await prisma.organization.upsert({
      where: { slug: 'acme' },
      update: {},
      create: { id: newId('org'), name: 'Acme Inc.', slug: 'acme' },
    });
    workspace = await prisma.workspace.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: 'growth' } },
      update: {},
      create: { id: newId('ws'), organizationId: org.id, name: 'Growth', slug: 'growth' },
    });
  }

  const s = await seedDemoWorkspace(prisma, {
    organizationId: org.id,
    workspaceId: workspace.id,
  });

  console.log(
    `Seeded demo data: ${org.slug}/${workspace.slug} (${org.id}, ${workspace.id})\n` +
      `  ${s.contacts} contacts, ${s.segments} segments, ${s.templates} templates, ` +
      `${s.campaigns} campaigns (${s.sends} sends), ${s.journeys} journeys, ${s.scoringRules} scoring rules\n` +
      `  ${s.forms} forms, 1 landing page, 1 widget, 1 in-app message, 1 booking page (${s.meetings} meetings)\n` +
      `  CRM pipeline "${s.pipelineName}" with ${s.stages} stages, ${s.deals} deals, and ${s.tasks} tasks\n` +
      `  write key ${s.writeKey}`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
