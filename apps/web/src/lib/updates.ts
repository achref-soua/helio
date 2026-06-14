import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseUpdateStatus, type UpdateJobStatus } from '@helio/core';

/**
 * The dashboard's half of the in-app update handshake (the other half is the
 * updater sidecar, infra/docker/updater/updater.sh). Both share one volume:
 * the dashboard drops a secret-guarded `request.json`; the sidecar and its
 * worker publish progress to `status.json`, which the dashboard polls back
 * across the restart the update causes.
 *
 * Nothing here trusts the volume: the request carries no command (only an
 * optional, validated version), and status reads are fully defensive — a
 * missing or malformed file just reads as "no job" (the parser lives in
 * @helio/core, where it is unit-tested).
 */

const STATUS_FILE = 'status.json';
const REQUEST_FILE = 'request.json';

/** Read the current job status, or null when there is no readable one. */
export function readUpdateStatus(stateDir: string): UpdateJobStatus | null {
  try {
    return parseUpdateStatus(readFileSync(path.join(stateDir, STATUS_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Drop a secret-guarded update request for the sidecar to pick up, and seed
 * an immediate `requested` status so the dashboard shows progress before the
 * sidecar's poll fires. The request is written to a temp file and renamed so
 * the poller never observes a half-written one.
 */
export function writeUpdateRequest(options: {
  stateDir: string;
  secret: string;
  target?: string;
}): void {
  const { stateDir, secret, target } = options;
  mkdirSync(stateDir, { recursive: true });

  const request = {
    secret,
    target: target ?? '',
    nonce: randomUUID(),
    requestedAt: new Date().toISOString(),
  };
  const tmp = path.join(stateDir, `.request.${process.pid}.${Date.now()}`);
  writeFileSync(tmp, JSON.stringify(request));
  renameSync(tmp, path.join(stateDir, REQUEST_FILE));

  const status: UpdateJobStatus = {
    phase: 'requested',
    version: '',
    targetVersion: target ?? '',
    message: 'Update queued…',
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(stateDir, STATUS_FILE), JSON.stringify(status));
}

/** Whether a status describes a finished job (terminal phase). */
export function isTerminalPhase(phase: string): boolean {
  return phase === 'done' || phase === 'failed';
}
