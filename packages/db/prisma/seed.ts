/* eslint-disable no-console -- seed is an operator-facing CLI script */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { newId } from '@helio/core';

import { createPrismaClient } from '../src/client';

// Standalone script: load the repo-root .env when present.
const repoRootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (fs.existsSync(repoRootEnv)) {
  process.loadEnvFile(repoRootEnv);
}

/**
 * Seed the demo workspace. Idempotent: safe to re-run.
 * Runs with the admin connection so it can write across tenants.
 */
async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_ADMIN_URL or DATABASE_URL must be set to seed');
  }
  const prisma = createPrismaClient(url);

  const org = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      id: newId('org'),
      name: 'Acme Inc.',
      slug: 'acme',
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'growth' } },
    update: {},
    create: {
      id: newId('ws'),
      organizationId: org.id,
      name: 'Growth',
      slug: 'growth',
    },
  });

  const demoContacts: Array<{
    email: string;
    firstName: string;
    lastName: string;
    attributes: Record<string, string>;
  }> = [
    {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      attributes: { plan: 'pro', company: 'Analytical Engines' },
    },
    {
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      attributes: { plan: 'pro', company: 'US Navy' },
    },
    {
      email: 'alan@example.com',
      firstName: 'Alan',
      lastName: 'Turing',
      attributes: { plan: 'free', company: 'Bletchley Park' },
    },
    {
      email: 'katherine@example.com',
      firstName: 'Katherine',
      lastName: 'Johnson',
      attributes: { plan: 'free', company: 'NASA' },
    },
    {
      email: 'edsger@example.com',
      firstName: 'Edsger',
      lastName: 'Dijkstra',
      attributes: { plan: 'trial', company: 'THE' },
    },
  ];
  const contacts = await Promise.all(
    demoContacts.map((contact) =>
      prisma.contact.upsert({
        where: { workspaceId_email: { workspaceId: workspace.id, email: contact.email } },
        update: {},
        create: {
          id: newId('contact'),
          organizationId: org.id,
          workspaceId: workspace.id,
          source: 'seed',
          ...contact,
        },
      }),
    ),
  );

  const list = await prisma.contactList.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'Pro customers' } },
    update: {},
    create: {
      id: newId('list'),
      organizationId: org.id,
      workspaceId: workspace.id,
      name: 'Pro customers',
    },
  });
  await prisma.contactListMember.createMany({
    data: contacts
      .filter((contact) => (contact.attributes as Record<string, string>).plan === 'pro')
      .map((contact) => ({
        listId: list.id,
        contactId: contact.id,
        organizationId: org.id,
      })),
    skipDuplicates: true,
  });

  await prisma.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId: org.id,
      workspaceId: workspace.id,
      action: 'workspace.seeded',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: { source: 'prisma/seed.ts' },
    },
  });

  console.log(
    `Seeded demo data: ${org.slug}/${workspace.slug} (${org.id}, ${workspace.id}), ` +
      `${contacts.length} contacts, list "${list.name}"`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
