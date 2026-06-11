/**
 * Release identity, baked into images at build time (HELIO_VERSION /
 * HELIO_COMMIT build args → env). Source checkouts report "dev" so a
 * missing var is visible rather than masquerading as a release.
 */
export function helioVersion(env: Record<string, string | undefined> = process.env): string {
  const version = env.HELIO_VERSION?.trim();
  return version ? version.replace(/^v/, '') : 'dev';
}

/** Short commit hash of the build, or null outside release images. */
export function helioCommit(env: Record<string, string | undefined> = process.env): string | null {
  const commit = env.HELIO_COMMIT?.trim();
  return commit ? commit.slice(0, 12) : null;
}

/**
 * True when `candidate` is a strictly newer release than `current`.
 * Handles `v` prefixes and pre-release suffixes (`2.0.0-rc.1 < 2.0.0`);
 * anything unparseable is never "newer" — the update notice stays quiet
 * rather than nagging on garbage input.
 */
export function isNewerHelioVersion(candidate: string, current: string): boolean {
  const parse = (raw: string): { main: number[]; pre: string | null } | null => {
    const cleaned = raw.trim().replace(/^v/, '');
    const [main = '', pre = null] = cleaned.split('-', 2) as [string, string?];
    const parts = main.split('.').map((part) => Number(part));
    if (parts.length === 0 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
      return null;
    }
    return { main: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], pre: pre ?? null };
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a.main[i]! !== b.main[i]!) return a.main[i]! > b.main[i]!;
  }
  // Same x.y.z: a release beats a pre-release; two pre-releases compare
  // numerically segment-aware ("rc.2" < "rc.10").
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true;
  if (b.pre === null) return false;
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0;
}

/** The standard liveness payload every Helio service reports. */
export function healthPayload(
  service: string,
  env: Record<string, string | undefined> = process.env,
): { status: 'ok'; service: string; version: string; commit: string | null } {
  return { status: 'ok', service, version: helioVersion(env), commit: helioCommit(env) };
}
