import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

let resolved: string | null = null;

/** The Mailpit UI base URL, resolved lazily AFTER the root .env loads —
 *  a module-scope constant would read MAILPIT_UI_PORT before any spec
 *  had a chance to load the env file and silently fall back to 8025. */
export function mailpitUrl(): string {
  if (resolved) return resolved;
  const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) loadEnvFile(rootEnv);
  resolved = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;
  return resolved;
}
