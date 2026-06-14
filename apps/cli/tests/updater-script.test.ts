import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Exercises the update sidecar's shell logic (infra/docker/updater/updater.sh)
 * in isolation. A stub `docker` on PATH records every invocation, so these
 * tests prove the security-critical properties without a real daemon:
 *   - a request with the wrong secret never launches anything;
 *   - a request's "target" is validated as a version, never a command;
 *   - a valid request launches a DETACHED, PROJECT-LESS worker (the property
 *     that lets it survive the `compose down` it triggers).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const UPDATER_SH = path.resolve(here, '../../../infra/docker/updater/updater.sh');

// A fake `docker` that logs its args and answers the few queries the script
// makes: self lookup, mount-source inspection, and the worker-exists check.
const DOCKER_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS"
case "$1" in
  ps)
    case "$2" in
      -q) echo selfcid ;;
      *) : ;;
    esac ;;
  inspect)
    case "$*" in
      */state*) echo "helio-selfhost_update-state" ;;
      *helio-home*) echo "/host/helio" ;;
    esac ;;
  run) echo workercid ;;
  *) : ;;
esac
`;

interface Harness {
  dir: string;
  stateDir: string;
  callsFile: string;
  run: (snippet: string) => { stdout: string; calls: string[] };
  request: (body: object) => void;
  status: () => Record<string, string>;
}

function harness(): Harness {
  const dir = mkdtempSync(path.join(tmpdir(), 'helio-updater-'));
  const binDir = path.join(dir, 'bin');
  const stateDir = path.join(dir, 'state');
  const callsFile = path.join(dir, 'docker-calls.log');
  execFileSync('mkdir', ['-p', binDir, stateDir]);
  writeFileSync(callsFile, '');
  const dockerStub = path.join(binDir, 'docker');
  writeFileSync(dockerStub, DOCKER_STUB);
  chmodSync(dockerStub, 0o755);

  const env = {
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    DOCKER_CALLS: callsFile,
    HELIO_UPDATER_SOURCED: '1',
    HELIO_STATE_DIR: stateDir,
    HELIO_HOME: '/helio-home',
    HELIO_COMPOSE_PROJECT: 'helio-selfhost',
    HELIO_UPDATE_SECRET: 'the-secret',
    HELIO_UPDATER_IMAGE: 'ghcr.io/achref-soua/helio-updater:v9.9.9',
  };

  return {
    dir,
    stateDir,
    callsFile,
    run(snippet) {
      const script = `export HELIO_UPDATER_SOURCED=1\n. "${UPDATER_SH}"\n${snippet}\n`;
      const stdout = execFileSync('/bin/sh', ['-c', script], { env, encoding: 'utf8' });
      const calls = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean);
      return { stdout, calls };
    },
    request(body) {
      writeFileSync(path.join(stateDir, 'request.json'), JSON.stringify(body));
    },
    status() {
      return JSON.parse(readFileSync(path.join(stateDir, 'status.json'), 'utf8'));
    },
  };
}

describe('updater.sh helpers', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('reads flat string fields and treats a missing one as empty', () => {
    expect(h.run(`json_field '{"secret":"abc","target":"v2.0.5"}' secret`).stdout.trim()).toBe(
      'abc',
    );
    expect(h.run(`json_field '{"secret":"abc","target":"v2.0.5"}' target`).stdout.trim()).toBe(
      'v2.0.5',
    );
    expect(h.run(`json_field '{"secret":"abc"}' target`).stdout.trim()).toBe('');
  });

  it('writes parseable status JSON', () => {
    h.run(`write_status running "" "v2.0.5" 'Doing "stuff" now'`);
    const status = h.status();
    expect(status.phase).toBe('running');
    expect(status.targetVersion).toBe('v2.0.5');
    expect(status.message).toBe('Doing "stuff" now');
  });
});

describe('updater.sh handle_request', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('launches a detached, project-less worker for a valid request', () => {
    h.request({ secret: 'the-secret', target: 'v2.0.5' });
    const { calls } = h.run('handle_request');
    const runCall = calls.find((c) => c.startsWith('run '));
    expect(runCall).toBeDefined();
    // Detached + self-removing.
    expect(runCall).toContain('-d');
    expect(runCall).toContain('--rm');
    // The fixed worker mode — the request never carries a command.
    expect(runCall).toContain('ghcr.io/achref-soua/helio-updater:v9.9.9 worker');
    // The target is passed as data, in an env var.
    expect(runCall).toContain('HELIO_UPDATE_TARGET=v2.0.5');
    // The install dir is mounted at its real host path (mount-at-same-path)
    // so helio's relative compose binds resolve to daemon-visible paths.
    expect(runCall).toContain('HELIO_HOME=/host/helio');
    // Project-less: NOT joined to the compose project (that is what lets it
    // outlive the `compose down`).
    expect(runCall).not.toContain('com.docker.compose.project');
    expect(runCall).not.toContain('--label');
    // Reuses the daemon-resolved mount sources discovered via inspect: the
    // install dir at its own host path, the state volume at the sidecar path.
    expect(runCall).toContain('/host/helio:/host/helio');
    expect(runCall).toContain(`helio-selfhost_update-state:${h.stateDir}`);
    expect(runCall).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(h.status().phase).toBe('starting');
  });

  it('rejects a request with the wrong secret and launches nothing', () => {
    h.request({ secret: 'wrong', target: 'v2.0.5' });
    const { calls } = h.run('handle_request');
    expect(calls.some((c) => c.startsWith('run '))).toBe(false);
    expect(h.status().phase).toBe('failed');
  });

  it('rejects a target that is not a plain version (no command injection)', () => {
    h.request({ secret: 'the-secret', target: 'v1.0.0; rm -rf /' });
    const { calls } = h.run('handle_request');
    expect(calls.some((c) => c.startsWith('run '))).toBe(false);
    expect(h.status().phase).toBe('failed');
  });

  it('accepts an empty target (update to latest)', () => {
    h.request({ secret: 'the-secret' });
    const { calls } = h.run('handle_request');
    expect(calls.some((c) => c.startsWith('run '))).toBe(true);
  });

  it('consumes the request file so it cannot be replayed', () => {
    h.request({ secret: 'the-secret', target: 'v2.0.5' });
    const { calls } = h.run('handle_request');
    expect(calls.some((c) => c.startsWith('run '))).toBe(true);
    // Second pass: the file is gone, so handle_request is a no-op.
    const second = h.run('handle_request');
    expect(second.calls.filter((c) => c.startsWith('run ')).length).toBe(1);
  });
});
