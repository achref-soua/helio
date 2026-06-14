import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Guards the self-host compose that ships in the install bundle. ClickHouse
 * does a slow first-boot init (create user + database) before its HTTP port
 * binds; on a cold disk that outran the healthcheck and `compose up --wait`
 * declared the whole install failed. These invariants keep the fix in place.
 */
const selfhost = readFileSync(
  new URL('../../../infra/compose/docker-compose.selfhost.yml', import.meta.url),
  'utf8',
);

/** The body of one top-level (two-space-indented) service block. */
function serviceBlock(compose: string, name: string): string {
  const lines = compose.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`service "${name}" not found in compose`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('self-host compose: ClickHouse startup resilience', () => {
  const clickhouse = serviceBlock(selfhost, 'clickhouse');

  it('has a healthcheck', () => {
    expect(clickhouse).toMatch(/healthcheck:/);
  });

  it('grants a start_period so first-boot init does not trip `up --wait`', () => {
    expect(clickhouse).toMatch(/start_period:\s*\d+s/);
  });

  it('raises the file-descriptor limit to the ClickHouse-recommended value', () => {
    expect(clickhouse).toMatch(/nofile:\s*262144/);
  });
});

describe('self-host compose: in-app update sidecar', () => {
  const updater = serviceBlock(selfhost, 'updater');

  it('runs behind its own optional `update` profile', () => {
    expect(updater).toMatch(/profiles:\s*\['update'\]/);
  });

  it('is the ONLY container that mounts the Docker socket', () => {
    // One mount line per service that binds the socket — only the updater may.
    const mounts = selfhost.match(/-\s*\/var\/run\/docker\.sock:/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(updater).toContain('/var/run/docker.sock:/var/run/docker.sock');
  });

  it('requires the shared update secret', () => {
    expect(updater).toMatch(/HELIO_UPDATE_SECRET:\s*\$\{HELIO_UPDATE_SECRET/);
  });

  it('shares the update-state volume with the web app', () => {
    expect(selfhost).toMatch(/^ {2}update-state:\s*$/m);
    expect(serviceBlock(selfhost, 'web')).toContain('update-state:/var/lib/helio/update-state');
    expect(updater).toContain('update-state:/state');
  });

  it('keeps the dashboard update toggle off by default in the stack', () => {
    expect(serviceBlock(selfhost, 'web')).toMatch(
      /HELIO_INAPP_UPDATE:\s*\$\{HELIO_INAPP_UPDATE:-false\}/,
    );
  });
});
