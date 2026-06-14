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
