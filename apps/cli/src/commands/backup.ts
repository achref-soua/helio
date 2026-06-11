import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { compose } from '../lib/docker';
import { envValue } from '../lib/envfile';
import { waitForHttpOk } from '../lib/health';
import { helioHome, type InstallPaths, installPaths, isInstalled } from '../lib/state';
import { confirmTyped, fail, prompt, say, warn } from '../lib/ui';
import { registerCommand } from '../registry';

/** Take one backup now and snapshot the .env beside it — a dump without
 *  the matching encryption key cannot reveal stored credentials. */
export async function runBackupNow(paths: InstallPaths, label: string): Promise<number> {
  const code = await compose(paths, ['run', '--rm', 'backup', 'run', label]);
  if (code === 0) {
    const envDir = path.join(paths.backupsDir, 'env');
    mkdirSync(envDir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    copyFileSync(paths.envFile, path.join(envDir, `${stamp}.env`));
    say(`backup done — .env snapshot saved to backups/env/${stamp}.env`);
  }
  return code;
}

registerCommand('backup', 'Take a database backup now', async (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: { label: { type: 'string', default: 'manual' } },
  });
  const paths = installPaths(helioHome());
  if (!isInstalled(paths)) fail(`no installation at ${paths.home}`);
  return runBackupNow(paths, values.label ?? 'manual');
});

registerCommand('restore', 'Restore a backup (DESTROYS current data)', async (argv) => {
  const file = argv.find((arg) => !arg.startsWith('-'));
  if (!file)
    fail('usage: helio restore <backup-filename> (see Settings → Backups, or ls ~/.helio/backups)');
  const paths = installPaths(helioHome());
  if (!isInstalled(paths)) fail(`no installation at ${paths.home}`);

  warn('Restoring REPLACES the current database with the backup. Anything newer is lost.');
  warn('Stored credentials only decrypt if HELIO_ENCRYPTION_KEY matches the one from backup time');
  warn('(.env snapshots live in ~/.helio/backups/env/).');
  if (!(await confirmTyped('Replace the database with this backup?', 'restore'))) {
    warn('aborted — nothing was changed');
    return 1;
  }

  const env = readFileSync(paths.envFile, 'utf8');
  const profiles = (envValue(env, 'COMPOSE_PROFILES') ?? 'core').split(',').filter(Boolean);

  say('stopping services…');
  await compose(paths, ['down'], { profiles });
  say('starting the database…');
  if ((await compose(paths, ['up', '-d', '--wait', 'postgres'])) !== 0) {
    fail('postgres failed to start');
  }

  const restoreEnv: string[] = [];
  if (file.endsWith('.enc')) {
    const passphrase = await prompt('Backup passphrase', '');
    if (!passphrase) fail('this backup is encrypted — the passphrase is required');
    restoreEnv.push('-e', `BACKUP_PASSPHRASE=${passphrase}`);
  }
  say('restoring…');
  if ((await compose(paths, ['run', '--rm', ...restoreEnv, 'backup', 'restore', file])) !== 0) {
    fail(
      'restore failed — the previous data volume is untouched only if pg_restore never started; check helio logs postgres',
    );
  }
  say('re-applying migrations (rolls an older dump forward)…');
  if ((await compose(paths, ['run', '--rm', 'migrate', 'deploy'], { profiles: ['ops'] })) !== 0) {
    fail('migrations failed after the restore');
  }
  say('starting Helio…');
  await compose(paths, ['up', '-d', '--wait'], { profiles });
  const appUrl = envValue(env, 'APP_URL') ?? 'http://localhost:3000';
  const healthy = await waitForHttpOk(`${appUrl}/api/healthz`, { timeoutMs: 120_000 });
  say(
    healthy ? `restore complete — ${appUrl}` : 'restore applied; the dashboard is still warming up',
  );
  return 0;
});
