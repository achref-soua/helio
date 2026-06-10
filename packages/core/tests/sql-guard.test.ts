import { describe, expect, it } from 'vitest';

import { guardAnalyticsQuery, MAX_SQL_LENGTH } from '../src/sql-guard';

function ok(sql: string) {
  const result = guardAnalyticsQuery(sql);
  expect(result.ok, `expected OK for: ${sql}`).toBe(true);
  return result.ok ? result.sql : '';
}

function rejected(sql: string) {
  const result = guardAnalyticsQuery(sql);
  expect(result.ok, `expected rejection for: ${sql}`).toBe(false);
}

describe('guardAnalyticsQuery — accepts safe reads', () => {
  it('scopes a bare SELECT with a shadowing events CTE', () => {
    const scoped = ok('SELECT event, count() FROM events GROUP BY event');
    expect(scoped).toBe(
      'WITH events AS (SELECT * FROM events WHERE workspace_id = {workspaceId:String}) ' +
        'SELECT event, count() FROM events GROUP BY event',
    );
  });

  it('injects the scope as the first CTE for a WITH query', () => {
    const scoped = ok('WITH t AS (SELECT event FROM events) SELECT * FROM t');
    expect(scoped.startsWith('WITH events AS (SELECT * FROM events WHERE workspace_id =')).toBe(
      true,
    );
    expect(scoped).toContain('), t AS (SELECT event FROM events) SELECT * FROM t');
  });

  it('allows CTE targets, subqueries, aliases, and ARRAY JOIN', () => {
    ok('WITH a AS (SELECT user_id FROM events) SELECT count() FROM a');
    ok('SELECT * FROM (SELECT user_id FROM events) AS sub');
    ok('SELECT e.event FROM events AS e');
    ok('SELECT x FROM events ARRAY JOIN JSONExtractArrayRaw(properties) AS x');
    ok('SELECT y FROM events LEFT ARRAY JOIN someArr AS y');
  });

  it('does not trip on table-ish words inside string literals', () => {
    ok("SELECT count() FROM events WHERE event = 'Signed up from system'");
    ok("SELECT count() FROM events WHERE properties = 'join the url file'");
    ok("SELECT JSONExtractString(properties, 'url') AS u FROM events");
  });

  it('strips a single trailing semicolon', () => {
    ok('SELECT 1 FROM events;');
  });
});

describe('guardAnalyticsQuery — blocks writes and non-SELECT', () => {
  it('rejects empty and over-long input', () => {
    rejected('   ');
    rejected(`SELECT ${'x'.repeat(MAX_SQL_LENGTH)} FROM events`);
  });

  for (const write of [
    'INSERT INTO events VALUES (1)',
    'ALTER TABLE events DELETE WHERE 1=1',
    'DROP TABLE events',
    'TRUNCATE TABLE events',
    'CREATE TABLE x (a Int)',
    'OPTIMIZE TABLE events',
  ]) {
    it(`rejects: ${write}`, () => rejected(write));
  }
});

describe('guardAnalyticsQuery — blocks injection vectors', () => {
  it('rejects multiple statements', () => {
    rejected('SELECT 1 FROM events; DROP TABLE events');
  });

  it('rejects comments that could hide payloads', () => {
    rejected('SELECT 1 FROM events -- ; DROP');
    rejected('SELECT 1 /* hi */ FROM events');
  });

  it('rejects backtick and double-quoted identifiers', () => {
    rejected('SELECT 1 FROM `events`');
    rejected('SELECT 1 FROM "system"."tables"');
  });
});

describe('guardAnalyticsQuery — enforces the events-only allow-list', () => {
  for (const escape of [
    'SELECT * FROM system.tables',
    'SELECT * FROM system.parts',
    'SELECT * FROM default.events',
    'SELECT * FROM other_table',
    'SELECT * FROM events JOIN system.columns USING (x)',
    "SELECT * FROM remote('1.2.3.4', default.events)",
    "SELECT * FROM url('http://evil', CSV)",
    "SELECT * FROM file('/etc/passwd')",
    "SELECT * FROM s3('http://x')",
    'SELECT * FROM numbers(10)',
    "SELECT * FROM mysql('h', 'db', 't', 'u', 'p')",
  ]) {
    it(`rejects cross-table/function: ${escape}`, () => rejected(escape));
  }

  it('blocks IO functions even in a scalar/select position', () => {
    rejected("SELECT url('http://evil') FROM events");
    rejected("SELECT file('/etc/passwd') AS x FROM events");
    rejected("SELECT dictGetString('d', 'a', toUInt64(1)) FROM events");
  });
});
