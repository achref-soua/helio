/* eslint-disable no-console -- the CLI talks to a human */
import { spawn, spawnSync } from 'node:child_process';

import type { InstallPaths } from './state';

/**
 * Docker detection and the compose exec wrapper. Everything `helio` does
 * to the stack goes through `docker compose` against the installation's
 * pinned file — the CLI never talks to the daemon API directly.
 */

export interface DockerStatus {
  dockerInstalled: boolean;
  daemonRunning: boolean;
  composeV2: boolean;
  hints: string[];
}

export function detectDocker(): DockerStatus {
  const hints: string[] = [];
  const version = spawnSync('docker', ['--version'], { stdio: 'pipe' });
  const dockerInstalled = !version.error && version.status === 0;
  if (!dockerInstalled) {
    if (process.platform === 'win32') {
      hints.push(
        'Install Docker Desktop (https://docs.docker.com/desktop/setup/install/windows-install/) — a normal, free app install; its installer sets up everything it needs (allow the one restart if it asks).',
      );
    } else if (process.platform === 'darwin') {
      hints.push(
        'Install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/) or OrbStack.',
      );
    } else {
      hints.push(
        'Install Docker Engine: https://docs.docker.com/engine/install/ (or `curl -fsSL https://get.docker.com | sh` on a fresh server).',
      );
    }
    return { dockerInstalled, daemonRunning: false, composeV2: false, hints };
  }

  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'pipe' });
  const daemonRunning = info.status === 0;
  if (!daemonRunning) {
    hints.push(
      process.platform === 'linux'
        ? 'The Docker daemon is not running: `sudo systemctl start docker` (and add your user to the docker group).'
        : 'Docker Desktop is installed but not running — start it and wait for the whale to settle.',
    );
  }

  const compose = spawnSync('docker', ['compose', 'version'], { stdio: 'pipe' });
  const composeV2 = compose.status === 0;
  if (!composeV2) {
    hints.push(
      'Docker Compose v2 is missing (`docker compose` — the plugin, not legacy docker-compose). It ships with Docker Desktop; on servers install docker-compose-plugin.',
    );
  }

  return { dockerInstalled, daemonRunning, composeV2, hints };
}

export interface ComposeOptions {
  profiles?: string[];
  interactive?: boolean;
}

/**
 * Compose interpolation lets the process environment override the
 * installation's env-file — and the Bun runtime auto-loads any `.env`
 * sitting in the directory `helio` happens to be run from, so a stray
 * project file could silently rewire ports and passwords. Compose
 * children therefore get an explicit allowlist: enough for docker to
 * work, nothing that can shadow ~/.helio/.env.
 */
const CHILD_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'USERPROFILE',
  'SystemRoot',
  'SystemDrive',
  'ComSpec',
  'ProgramFiles',
  'ProgramData',
  'LOCALAPPDATA',
  'APPDATA',
  'TEMP',
  'TMP',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
  'DOCKER_CONTEXT',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
];

export function composeChildEnv(): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) child[key] = process.env[key];
  }
  return child;
}

/** Run docker compose against the installation; resolves with the exit code. */
export function compose(
  paths: InstallPaths,
  args: string[],
  options: ComposeOptions = {},
): Promise<number> {
  const fullArgs = [
    'compose',
    '--file',
    paths.composeFile,
    '--env-file',
    paths.envFile,
    ...(options.profiles?.flatMap((profile) => ['--profile', profile]) ?? []),
    ...args,
  ];
  return new Promise((resolve) => {
    const child = spawn('docker', fullArgs, {
      stdio: options.interactive === false ? 'pipe' : 'inherit',
      cwd: paths.home,
      env: composeChildEnv(),
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(error.message);
      resolve(1);
    });
  });
}

/** Run and capture (for status parsing). */
export function composeCapture(
  paths: InstallPaths,
  args: string[],
  profiles?: string[],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--file',
      paths.composeFile,
      '--env-file',
      paths.envFile,
      ...(profiles?.flatMap((profile) => ['--profile', profile]) ?? []),
      ...args,
    ],
    { stdio: 'pipe', cwd: paths.home, env: composeChildEnv() },
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  };
}
