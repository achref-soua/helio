import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  assetUrl,
  bundleAssetName,
  downloadAsset,
  extractTarGz,
  resolveLatestTag,
  verifyBundle,
} from '../lib/bundle';
import { compose } from '../lib/docker';
import { envValue, mergeTemplate } from '../lib/envfile';
import { waitForHttpOk } from '../lib/health';
import { helioHome, installPaths, isInstalled, readManifest, writeManifest } from '../lib/state';
import { banner, confirm, fail, say, warn } from '../lib/ui';
import { CLI_VERSION, registerCommand } from '../registry';
import { runBackupNow } from './backup';

function newerThan(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('-')[0]!.split('.').map(Number);
  const [a, b] = [parse(candidate), parse(current)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return candidate !== current && candidate.replace(/^v/, '') > current.replace(/^v/, '');
}

async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: 'string' },
      'no-backup': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
    },
  });

  banner(CLI_VERSION, 'updating, with a safety backup first');

  const paths = installPaths(helioHome());
  if (!isInstalled(paths)) fail(`no installation at ${paths.home} — run "helio install" first`);
  const current = readManifest(paths)?.version ?? 'v0.0.0';

  let tag = values.version ?? (await resolveLatestTag());
  if (!tag.startsWith('v')) tag = `v${tag}`;
  if (tag === current) {
    say(`already on ${current}`);
    return 0;
  }
  if (!newerThan(tag, current) && !values.force) {
    fail(
      `${tag} is not newer than the installed ${current} (use --force to downgrade — restores need a matching database backup)`,
    );
  }
  say(`updating ${current} → ${tag}`);

  // 1. Pre-update backup (the rollback path — Prisma has no down-migrations).
  if (values['no-backup']) {
    warn('skipping the pre-update backup (--no-backup): a failed update cannot be rolled back');
    if (!values.yes && !(await confirm('Continue without a safety backup?', false))) return 1;
  } else {
    say('taking a pre-update backup…');
    const code = await runBackupNow(paths, 'pre-update');
    if (code !== 0) {
      fail(
        'the pre-update backup failed — fix that first, or re-run with --no-backup at your own risk',
      );
    }
  }

  // 2. Fetch + verify the new bundle; archive the current one for rollback.
  const bundleDir = path.join(paths.releasesDir, tag);
  const archive = path.join(bundleDir, bundleAssetName(tag));
  await downloadAsset(assetUrl(tag, bundleAssetName(tag)), archive);
  extractTarGz(archive, bundleDir);
  const manifest = verifyBundle(bundleDir);

  const previousDir = path.join(paths.releasesDir, current);
  mkdirSync(previousDir, { recursive: true });
  copyFileSync(paths.composeFile, path.join(previousDir, 'docker-compose.yml'));

  // 3. Swap: stop apps, lay down the new compose, append any new env keys.
  say('stopping services…');
  await compose(paths, ['down']);
  copyFileSync(path.join(bundleDir, 'docker-compose.yml'), paths.composeFile);
  const template = readFileSync(path.join(bundleDir, '.env.template'), 'utf8');
  const merged = mergeTemplate(readFileSync(paths.envFile, 'utf8'), template, tag);
  if (merged.added.length > 0) {
    writeFileSync(paths.envFile, merged.content);
    say(`new settings appended to .env: ${merged.added.join(', ')}`);
  }

  // 4. Pull, migrate, start, verify.
  const env = readFileSync(paths.envFile, 'utf8');
  const profiles = (envValue(env, 'COMPOSE_PROFILES') ?? 'core').split(',').filter(Boolean);
  say('pulling the new images…');
  if ((await compose(paths, ['pull'], { profiles })) !== 0) fail('image pull failed');
  if ((await compose(paths, ['up', '-d', '--wait', 'postgres', 'redis', 'mailpit'])) !== 0) {
    fail('datastores failed to start');
  }
  say('applying database migrations…');
  if ((await compose(paths, ['run', '--rm', 'migrate', 'deploy'], { profiles: ['ops'] })) !== 0) {
    fail(
      `migrations failed. Roll back: helio restore <the pre-update backup> --to-version ${current}`,
    );
  }
  if ((await compose(paths, ['up', '-d', '--wait'], { profiles })) !== 0) {
    fail(
      `services failed to start. Roll back: helio restore <the pre-update backup> --to-version ${current}`,
    );
  }
  writeManifest(paths, { name: 'helio', version: manifest.version, files: manifest.files });

  const appUrl = envValue(env, 'APP_URL') ?? 'http://localhost:3000';
  const healthy = await waitForHttpOk(`${appUrl}/api/healthz`, { timeoutMs: 120_000 });
  say(
    healthy
      ? `Helio ${tag} is up at ${appUrl}`
      : `update applied; the dashboard is still warming up (${appUrl})`,
  );
  return 0;
}

registerCommand('update', 'Update to a newer release (with a safety backup)', run);
