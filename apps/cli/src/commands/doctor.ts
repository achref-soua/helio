/* eslint-disable no-console -- the CLI talks to a human */
import { readFileSync, statfsSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';

import { detectDocker } from '../lib/docker';
import { envValue } from '../lib/envfile';
import { helioHome, installPaths, isInstalled, readManifest } from '../lib/state';
import { registerCommand } from '../registry';

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

async function run(): Promise<number> {
  let healthy = true;
  const check = (ok: boolean, label: string, hint?: string) => {
    console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}`);
    if (!ok && hint) console.log(`      - ${hint}`);
    if (!ok) healthy = false;
  };

  const docker = detectDocker();
  check(docker.dockerInstalled, 'docker is installed', docker.hints[0]);
  check(docker.daemonRunning, 'docker daemon is running', docker.hints[0]);
  check(docker.composeV2, 'docker compose v2 is available', docker.hints[0]);

  const paths = installPaths(helioHome());
  const installed = isInstalled(paths);
  if (installed) {
    const manifest = readManifest(paths);
    console.log(
      ` ok   helio is installed at ${paths.home} (${manifest?.version ?? 'unknown version'})`,
    );
    try {
      const env = readFileSync(paths.envFile, 'utf8');
      check(Boolean(envValue(env, 'HELIO_ENCRYPTION_KEY')), 'the credential-vault key is set');
    } catch {
      check(false, 'the .env file is readable');
    }
  } else {
    console.log(` -    no installation at ${paths.home} yet (run: helio install)`);
    // Fresh installs need the default ports free.
    for (const port of [3000, 4000, 8025]) {
      check(
        !(await portBusy(port)),
        `port ${port} is free`,
        `something is listening on ${port}; stop it, or change the port in ${paths.envFile} after installing`,
      );
    }
  }

  try {
    const stats = statfsSync(homedir());
    const freeGb = (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3;
    check(
      freeGb > 2,
      `disk space (${freeGb.toFixed(1)} GiB free)`,
      'Helio needs at least ~2 GiB free',
    );
  } catch {
    // statfs unsupported on this platform — not worth failing over.
  }

  console.log(
    healthy ? '\neverything looks good' : '\nfix the items above and re-run helio doctor',
  );
  return healthy ? 0 : 1;
}

registerCommand('doctor', 'Check Docker, ports, and the installation', () => run());
