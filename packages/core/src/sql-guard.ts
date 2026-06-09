/**
 * Guard for the analytics SQL explorer. Lets an operator run ad-hoc read-only
 * queries over their own events without opening a tenant-isolation or
 * arbitrary-table hole. Defense in depth, in order:
 *
 *  1. Single statement, no comments, no quoted identifiers (backtick/double
 *     quote) — those are the usual ways to smuggle a second table reference.
 *  2. Read-only shape: the query must start with SELECT or WITH … SELECT.
 *  3. Table allow-list: every FROM/JOIN target must be the `events` table or a
 *     CTE the query itself defines. This blocks `system.*`, other databases,
 *     and every table function (remote/url/file/s3/…), since those never match.
 *  4. Tenant scoping: `events` is rewritten to a CTE pre-filtered to the
 *     workspace, so the caller only ever sees their own rows.
 *
 * The caller still runs the result with ClickHouse `readonly=1` plus row/time
 * caps, and must confirm the workspace belongs to the org first.
 */

export const MAX_SQL_ROWS = 1000;
export const MAX_SQL_LENGTH = 5000;

export type SqlGuardResult = { ok: true; sql: string } | { ok: false; error: string };

const fail = (error: string): SqlGuardResult => ({ ok: false, error });

/** Replace single-quoted string contents so literals can't trip the scanners. */
function stripStrings(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

export function guardAnalyticsQuery(rawSql: string): SqlGuardResult {
  const sql = rawSql.trim().replace(/;+\s*$/, '');
  if (!sql) return fail('Enter a query.');
  if (sql.length > MAX_SQL_LENGTH) return fail('Query is too long.');

  // Analyze a copy with string contents removed and ARRAY JOIN neutralized, so
  // string data and the array-join operator don't look like table references.
  const analysis = stripStrings(sql).replace(/\b(?:left\s+)?array\s+join\b/gi, '  ');

  if (analysis.includes(';')) return fail('Only a single statement is allowed.');
  if (/--|\/\*/.test(analysis)) return fail('Comments are not allowed.');
  if (/[`"]/.test(analysis)) return fail('Backtick and double-quoted identifiers are not allowed.');
  if (!/^\s*(?:with\b[\s\S]+\bselect\b|select\b)/i.test(analysis)) {
    return fail('Only SELECT queries are allowed.');
  }

  // Table/IO functions can read other data or reach the network even in a
  // scalar position (e.g. `SELECT url('http://…')`), so they're blocked
  // wherever they appear. Matching requires a `(`, so columns/strings are safe.
  if (
    /\b(?:url|file|s3|s3Cluster|remote|remoteSecure|cluster|clusterAllReplicas|mysql|postgresql|jdbc|odbc|hdfs|executable|merge|dictGet\w*)\s*\(/i.test(
      analysis,
    )
  ) {
    return fail('That function is not allowed.');
  }

  // CTE names the query defines (… name AS ( …) form), which are valid targets.
  const cteNames = new Set<string>();
  for (const match of analysis.matchAll(/(?:\bwith|,)\s+([a-zA-Z_]\w*)\s+as\s*\(/gi)) {
    cteNames.add(match[1]!.toLowerCase());
  }

  // Every FROM/JOIN target must be `events` or one of those CTEs. Subqueries
  // (`from (`) start with a paren and never match this pattern, so they pass.
  for (const match of analysis.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w.]*)/gi)) {
    const target = match[1]!.toLowerCase();
    if (target !== 'events' && !cteNames.has(target)) {
      return fail(`Only the events table can be queried (saw "${match[1]}").`);
    }
  }

  // Shadow the real events table with a workspace-scoped CTE of the same name.
  const scope = `events AS (SELECT * FROM events WHERE workspace_id = {workspaceId:String})`;
  const scoped = /^\s*with\b/i.test(sql)
    ? sql.replace(/^(\s*)with\b/i, `$1WITH ${scope},`)
    : `WITH ${scope} ${sql}`;
  // The {workspaceId:String} placeholder is bound at execution via query params.
  return { ok: true, sql: scoped };
}
