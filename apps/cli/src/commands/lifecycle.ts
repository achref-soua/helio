/* eslint-disable no-console -- the CLI talks to a human */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { compose, composeCapture } from '../lib/docker';
import { envValue } from '../lib/envfile';
import { waitForHttpOk } from '../lib/health';
import {
  helioHome,
  type InstallPaths,
  installPaths,
  isInstalled,
  readManifest,
} from '../lib/state';
import { confirmTyped, fail, say, warn } from '../lib/ui';
import { registerCommand } from '../registry';

/** Day-2 lifecycle: thin, predictable wrappers over docker compose. */

function requireInstall(): { paths: InstallPaths; env: string; profiles: string[] } {
  const paths = installPaths(helioHome());
  if (!isInstalled(paths)) {
    fail(`no installation at ${paths.home} — run "helio install" first`);
  }
  const env = readFileSync(paths.envFile, 'utf8');
  const profiles = (envValue(env, 'COMPOSE_PROFILES') ?? 'core').split(',').filter(Boolean);
  return { paths, env, profiles };
}

registerCommand('up', 'Start (or restart) the stack', async (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: { full: { type: 'boolean', default: false } },
  });
  const { paths, env, profiles } = requireInstall();
  let active = profiles;
  if (values.full && !profiles.includes('full')) {
    // Persist the upgrade to the full stack so later commands agree.
    writeFileSync(paths.envFile, env.replace(/^COMPOSE_PROFILES=.*$/m, 'COMPOSE_PROFILES=full'));
    active = ['full'];
    say('switching this installation to the full profile');
  }
  return compose(paths, ['up', '-d', '--wait'], { profiles: active });
});

registerCommand('down', 'Stop the stack (data is kept)', async () => {
  const { paths, profiles } = requireInstall();
  return compose(paths, ['down'], { profiles });
});

registerCommand('status', 'Show services, version, and health', async () => {
  const { paths, env, profiles } = requireInstall();
  const manifest = readManifest(paths);
  say(`helio ${manifest?.version ?? 'unknown'} at ${paths.home} (profile: ${profiles.join(',')})`);
  const result = composeCapture(
    paths,
    ['ps', '--format', 'table {{.Service}}\t{{.Status}}'],
    profiles,
  );
  console.log(result.stdout.trim() || 'no services are running');
  const appUrl = envValue(env, 'APP_URL') ?? 'http://localhost:3000';
  const healthy = await waitForHttpOk(`${appUrl}/api/healthz`, {
    timeoutMs: 4_000,
    intervalMs: 1_000,
  });
  say(healthy ? `dashboard answering at ${appUrl}` : `dashboard not answering at ${appUrl}`);
  return result.status;
});

registerCommand('logs', 'Tail service logs (helio logs [service])', async (argv) => {
  const { paths, profiles } = requireInstall();
  const service = argv.find((arg) => !arg.startsWith('-'));
  return compose(paths, ['logs', '--tail', '200', '--follow', ...(service ? [service] : [])], {
    profiles,
  });
});

registerCommand('seed', 'Load the demo workspace (idempotent)', async () => {
  const { paths } = requireInstall();
  return compose(paths, ['run', '--rm', 'migrate', 'seed'], { profiles: ['ops'] });
});

registerCommand('uninstall', 'Stop Helio and optionally erase its data', async (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: { 'purge-data': { type: 'boolean', default: false } },
  });
  const { paths, profiles } = requireInstall();
  const scope = values['purge-data']
    ? 'This stops Helio and PERMANENTLY ERASES its database, volumes, and configuration.'
    : 'This stops Helio and removes its containers (data volumes are kept).';
  if (!(await confirmTyped(scope, 'uninstall'))) {
    warn('aborted — nothing was changed');
    return 1;
  }
  const code = await compose(paths, ['down', ...(values['purge-data'] ? ['--volumes'] : [])], {
    profiles,
  });
  if (values['purge-data']) {
    rmSync(paths.home, { recursive: true, force: true });
    say(`removed ${paths.home}`);
  } else {
    say(`kept ${paths.home} (config, .env, backups) — "helio up" brings it back`);
  }
  return code;
});
