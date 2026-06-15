/**
 * SSRF guard for server-side fetches of operator-supplied URLs (outbound
 * webhooks, "test connection" probes, BYO model endpoints, …).
 *
 * The danger: an authenticated operator can point one of those URLs at the
 * deployment's own network — `http://127.0.0.1:6379`, `http://10.x`, or the
 * cloud metadata service `http://169.254.169.254/…` — and use Helio as a
 * confused deputy to read internal services. RLS doesn't help here: the call
 * leaves the trust boundary entirely.
 *
 * `assertPublicUrl` rejects anything that isn't an `http(s)` URL whose host is a
 * public address. Two layers:
 *
 *  1. Scheme + literal host — synchronous, no network. WHATWG `URL` already
 *     normalizes decimal/hex/octal IPv4 (`http://2130706433/` → `127.0.0.1`)
 *     and brackets IPv6, so we classify the normalized host.
 *  2. DNS — a hostname can resolve to a private address, so a `resolve` function
 *     is injected (callers pass a `node:dns` lookup) and every resolved A/AAAA
 *     is classified. Resolver is injected to keep this module isomorphic and to
 *     let tests run without DNS.
 *
 * This mirrors the Python intelligence guard (`model_runtime/http_model.py`
 * `_host_is_private`) so both planes block the same ranges.
 *
 * Residual risk: a resolve-then-fetch gap leaves a narrow DNS-rebinding window
 * (the host could re-resolve to a private IP between the check and the socket).
 * For the operator-configured-URL threat model that's acceptable; pinning the
 * connection to the validated IP is a documented follow-up.
 */

/** Thrown when a URL is not safe to fetch from a server. */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export interface AssertPublicUrlOptions {
  /**
   * Allow private/loopback/link-local targets. Off by default; operators opt in
   * per surface (e.g. a LAN webhook receiver or a self-hosted model server).
   */
  allowPrivate?: boolean;
  /** Require `https`. Off by default — plain `http` to a public host is allowed. */
  requireHttps?: boolean;
  /**
   * Resolve a hostname to its IP literals (A/AAAA). Injected so this module
   * stays isomorphic and unit tests need no DNS. Node callers pass
   * `(h) => dns.lookup(h, { all: true }).then(rs => rs.map(r => r.address))`.
   * When omitted, named hosts get only a cheap internal-name heuristic — any
   * caller facing untrusted input MUST supply a resolver.
   */
  resolve?: (hostname: string) => Promise<string[]>;
}

/** Hostnames that never belong to a public target, used when no resolver is given. */
const INTERNAL_NAME = /^(?:localhost|.*\.(?:local|internal|lan|intranet|home\.arpa|localhost))$/i;

function parseGroups(expanded: string): number[] | null {
  const parts = expanded.split(':');
  if (parts.length !== 8) return null;
  const groups: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

/** Classify a dotted-quad IPv4 literal. Returns null when it isn't valid IPv4. */
function blockedV4(ip: string): boolean | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  const [a, b, c] = o as [number, number, number, number];
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10/8 private
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT (Alibaba metadata 100.100.x)
    a === 127 || // 127/8 loopback
    (a === 169 && b === 254) || // 169.254/16 link-local incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 0 && c === 0) || // 192.0.0/24 IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // 192.0.2/24 TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 192.88.99/24 6to4 relay anycast
    (a === 192 && b === 168) || // 192.168/16 private
    (a === 198 && (b === 18 || b === 19)) || // 198.18/15 benchmarking
    (a === 198 && b === 51 && c === 100) || // 198.51.100/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // 203.0.113/24 TEST-NET-3
    a >= 224 // 224/4 multicast + 240/4 reserved + 255.255.255.255
  );
}

/**
 * True when `ip` (an IPv4 or IPv6 literal) is an address a server should never
 * be coerced into reaching. Returns false for public addresses and for strings
 * that aren't IP literals (those are hostnames — resolve them first).
 */
export function isBlockedAddress(ip: string): boolean {
  let host = ip.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zone = host.indexOf('%'); // strip IPv6 zone id, e.g. fe80::1%eth0
  if (zone !== -1) host = host.slice(0, zone);

  const v4 = blockedV4(host);
  if (v4 !== null) return v4;
  if (!host.includes(':')) return false; // a hostname, not an IP literal

  // IPv6 with an embedded IPv4 tail (`::ffff:1.2.3.4`, `::1.2.3.4`): the v4 is
  // what a connection actually reaches, so classify by it.
  if (host.includes('.')) {
    const tail = host.slice(host.lastIndexOf(':') + 1);
    const embedded = blockedV4(tail);
    if (embedded !== null) return embedded;
    return true; // malformed embedded form — treat as unsafe
  }

  // Expand `::` to a full eight-group address, then classify by prefix.
  let expanded = host;
  if (host.includes('::')) {
    const [left, right] = host.split('::') as [string, string];
    const l = left ? left.split(':') : [];
    const r = right ? right.split(':') : [];
    const missing = 8 - (l.length + r.length);
    if (missing < 0) return true;
    expanded = [...l, ...Array(missing).fill('0'), ...r].join(':');
  }
  const g = parseGroups(expanded);
  if (!g) return true; // unparseable — fail closed
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  // IPv4-mapped in hextet form (`::ffff:7f00:1` == ::ffff:127.0.0.1) — the
  // socket reaches the embedded v4, so classify by it.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const hi = g[6]!;
    const lo = g[7]!;
    return blockedV4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`) ?? true;
  }
  const g0 = g[0]!;
  return (
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g0 & 0xff00) === 0xff00 || // ff00::/8 multicast
    (g0 === 0x2001 && g[1] === 0x0db8) // 2001:db8::/32 documentation
  );
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Throw {@link SsrfError} unless `rawUrl` is safe to fetch from a server.
 * Returns the parsed {@link URL} on success.
 */
export async function assertPublicUrl(
  rawUrl: string,
  options: AssertPublicUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`unsupported URL scheme "${url.protocol}" (only http/https)`);
  }
  if (options.requireHttps && url.protocol !== 'https:' && !options.allowPrivate) {
    throw new SsrfError('the URL must use https');
  }

  // Opt-out for LAN targets: skip address classification but keep the scheme check.
  if (options.allowPrivate) return url;

  let host = url.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) throw new SsrfError('the URL has no host');

  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) {
      throw new SsrfError('the URL targets a private or reserved address');
    }
    return url;
  }

  // A name: block obvious internal names, then verify every resolved address.
  if (INTERNAL_NAME.test(host)) {
    throw new SsrfError('the URL targets an internal hostname');
  }
  if (options.resolve) {
    let addresses: string[];
    try {
      addresses = await options.resolve(host);
    } catch {
      throw new SsrfError('the hostname did not resolve');
    }
    if (addresses.length === 0) throw new SsrfError('the hostname did not resolve');
    for (const address of addresses) {
      if (isBlockedAddress(address)) {
        throw new SsrfError('the hostname resolves to a private or reserved address');
      }
    }
    return url;
  }
  // No resolver: can't confirm the address. Bare single-label names (`redis`,
  // `postgres`) are almost always internal service names, so refuse them;
  // dotted public names are allowed best-effort (production callers inject a
  // resolver, which classifies the real address above).
  if (!host.includes('.')) {
    throw new SsrfError('the URL targets an internal hostname');
  }
  return url;
}
