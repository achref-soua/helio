import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { Client } from 'pg';

/**
 * Deterministic E2E: every suite starts from an empty LOCAL development
 * database and an empty mailbox. Truncates all tables (migrations table
 * excluded) over DATABASE_ADMIN_URL — owner-consented, dev-only wipe;
 * point this at nothing you care about.
 */
export default async function globalSetup() {
  const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) loadEnvFile(rootEnv);

  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL must be set for e2e');
  if (!/localhost|127\.0\.0\.1|postgres:/.test(connectionString)) {
    throw new Error('Refusing to wipe a non-local database in e2e global setup');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
      await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }

  // Resolved here, not at module load — MAILPIT_UI_PORT comes from the
  // root .env read above, so an import-time constant would miss it.
  const mailpit = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;
  await fetch(`${mailpit}/api/v1/messages`, { method: 'DELETE' });
}
