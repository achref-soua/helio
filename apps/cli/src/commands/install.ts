import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { compose, detectDocker } from '../lib/docker';
import { envValue, fillTemplate } from '../lib/envfile';
import { waitForHttpOk } from '../lib/health';
import { helioHome, installPaths, isInstalled, writeManifest } from '../lib/state';
import { confirm, fail, prompt, say, warn } from '../lib/ui';
import { registerCommand } from '../registry';

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: 'string' },
      dir: { type: 'string' },
      profile: { type: 'string' },
      'bundle-file': { type: 'string' },
      'no-browser': { type: 'boolean', default: false },
      'seed-demo': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
    },
  });

  // 1. Docker first — nothing works without it.
  const docker = detectDocker();
  if (!docker.dockerInstalled || !docker.daemonRunning || !docker.composeV2) {
    for (const hint of docker.hints) warn(hint);
    fail('Docker is not ready — fix the above, then re-run helio install');
  }

  const paths = installPaths(values.dir ?? helioHome());
  if (isInstalled(paths)) {
    fail(
      `Helio is already installed at ${paths.home} — use "helio update" to move to a newer release`,
    );
  }
  mkdirSync(paths.releasesDir, { recursive: true });

  // 2. Acquire the release bundle.
  let bundleDir: string;
  let tag: string;
  if (values['bundle-file']) {
    tag = 'local-bundle';
    bundleDir = path.join(paths.releasesDir, tag);
    extractTarGz(path.resolve(values['bundle-file']), bundleDir);
  } else {
    tag = values.version ?? (await resolveLatestTag());
    if (!tag.startsWith('v')) tag = `v${tag}`;
    say(`installing Helio ${tag}`);
    bundleDir = path.join(paths.releasesDir, tag);
    const archive = path.join(bundleDir, bundleAssetName(tag));
    await downloadAsset(assetUrl(tag, bundleAssetName(tag)), archive);
    extractTarGz(archive, bundleDir);
  }
  const manifest = verifyBundle(bundleDir);
  say(`bundle ${manifest.version} verified`);

  // 3. Lay down the installation: pinned compose + a freshly-secreted .env.
  copyFileSync(path.join(bundleDir, 'docker-compose.yml'), paths.composeFile);
  const template = readFileSync(path.join(bundleDir, '.env.template'), 'utf8');
  const { content } = fillTemplate(template);

  const profile =
    values.profile ??
    (values.yes
      ? 'core'
      : await prompt(
          'Which stack? core = dashboard/API/AI (~2.5 GB RAM); full adds campaign sending, tracking & analytics (~8 GB hosts)',
          'core',
        ));
  if (profile !== 'core' && profile !== 'full') fail(`unknown profile "${profile}"`);
  const envContent = content.replace(/^COMPOSE_PROFILES=.*$/m, `COMPOSE_PROFILES=${profile}`);
  writeFileSync(paths.envFile, envContent);
  chmodSync(paths.envFile, 0o600);
  writeManifest(paths, { name: 'helio', version: manifest.version, files: manifest.files });
  say(`secrets generated into ${paths.envFile} (keep this file with your backups)`);

  // 4. Bring the stack up: infra → migrations → apps.
  const profiles = [profile];
  say('pulling images (first install downloads ~1–2 GB)…');
  if ((await compose(paths, ['pull'], { profiles })) !== 0) {
    fail('image pull failed — is this release published? (helio install --version vX.Y.Z)');
  }
  say('starting datastores…');
  if ((await compose(paths, ['up', '-d', '--wait', 'postgres', 'redis', 'mailpit'])) !== 0) {
    fail('datastores failed to start — run "helio logs postgres" to inspect');
  }
  say('applying database migrations…');
  if ((await compose(paths, ['run', '--rm', 'migrate', 'deploy'], { profiles: ['ops'] })) !== 0) {
    fail('migrations failed — run "helio logs" to inspect');
  }
  say('starting Helio…');
  if ((await compose(paths, ['up', '-d', '--wait'], { profiles })) !== 0) {
    fail('services failed to become healthy — run "helio status" and "helio logs web"');
  }

  const appUrl = envValue(envContent, 'APP_URL') ?? 'http://localhost:3000';
  const healthy = await waitForHttpOk(`${appUrl}/api/healthz`, { timeoutMs: 120_000 });
  if (!healthy) {
    warn(`the dashboard did not answer at ${appUrl} yet — "helio status" shows progress`);
  }

  // 5. Optional demo data, then hand over to the browser.
  const wantSeed =
    values['seed-demo'] ||
    (!values.yes &&
      (await confirm('Load a demo workspace (sample contacts, segments, journeys)?', false)));
  if (wantSeed) {
    await compose(paths, ['run', '--rm', 'migrate', 'seed'], { profiles: ['ops'] });
  }

  say('');
  say('Helio is up.');
  say(`  dashboard   ${appUrl}`);
  say(`  test inbox  http://localhost:${envValue(envContent, 'MAILPIT_UI_PORT') ?? '8025'}`);
  say(`  manage      helio status | helio logs | helio update | helio down`);
  say('');
  say('Create the first account in your browser — it becomes the administrator.');
  if (!values['no-browser']) openBrowser(appUrl);
  return 0;
}

registerCommand('install', 'Download, configure, and start Helio', run);
