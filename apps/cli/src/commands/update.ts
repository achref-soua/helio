import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  assetUrl,
  bundleAssetName,
  type BundleManifest,
  downloadAsset,
  extractTarGz,
  resolveLatestTag,
  verifyBundle,
} from '../lib/bundle';
import { compose } from '../lib/docker';
import { envValue, mergeTemplate } from '../lib/envfile';
import { waitForHttpOk } from '../lib/health';
import { isSelfUpdateNeeded, selfUpdateBinary } from '../lib/self-update';
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
      'bundle-file': { type: 'string' },
      'no-backup': { type: 'boolean', default: false },
      'no-self-update': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
    },
  });

  banner(CLI_VERSION, 'updating, with a safety backup first');

  const paths = installPaths(helioHome());
  if (!isInstalled(paths)) fail(`no installation at ${paths.home} — run "helio install" first`);
  const current = readManifest(paths)?.version ?? 'v0.0.0';

  // Acquire the new bundle. A local file (air-gapped sites, and the way the
  // in-app updater path is exercised in tests) is verified up front so its
  // manifest names the version we are moving to; otherwise we resolve a tag
  // and download below, after the version gate and backup.
  const bundleFile = values['bundle-file'];
  let tag: string;
  let bundleDir: string | undefined;
  let manifest: BundleManifest | undefined;
  if (bundleFile !== undefined) {
    bundleDir = path.join(paths.releasesDir, '.incoming');
    rmSync(bundleDir, { recursive: true, force: true });
    extractTarGz(path.resolve(bundleFile), bundleDir);
    manifest = verifyBundle(bundleDir);
    tag = manifest.version.startsWith('v') ? manifest.version : `v${manifest.version}`;
  } else {
    tag = values.version ?? (await resolveLatestTag());
    if (!tag.startsWith('v')) tag = `v${tag}`;
  }
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

  // 2. Fetch + verify the new bundle (unless a local --bundle-file already
  // gave us a verified one); archive the current compose for rollback.
  if (bundleDir === undefined || manifest === undefined) {
    bundleDir = path.join(paths.releasesDir, tag);
    const archive = path.join(bundleDir, bundleAssetName(tag));
    await downloadAsset(assetUrl(tag, bundleAssetName(tag)), archive);
    extractTarGz(archive, bundleDir);
    manifest = verifyBundle(bundleDir);
  }

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

  // Keep the `helio` command itself current, so `helio --version` and the
  // next run reflect the release just applied — not whatever was first
  // installed. Best-effort: the stack is already updated. Skipped for the
  // in-app updater worker (--no-self-update, an ephemeral binary) and for
  // air-gapped installs (--bundle-file ships no binary).
  if (
    !values['no-self-update'] &&
    bundleFile === undefined &&
    isSelfUpdateNeeded(CLI_VERSION, tag)
  ) {
    try {
      const result = await selfUpdateBinary(tag);
      if (result.updated) say(`the helio command is now ${tag} too`);
      else say(`left the helio command as-is (${result.reason})`);
    } catch (error) {
      warn(
        `the stack updated, but refreshing the helio command failed (${error instanceof Error ? error.message : String(error)}). ` +
          'Re-run the install command to refresh it.',
      );
    }
  }
  return 0;
}

registerCommand('update', 'Update to a newer release (with a safety backup)', run);
