import { generateHex, generatePassword, generateVapidPair, generateVaultKey } from './secrets';

/**
 * The .env contract between the bundle's template and this CLI:
 *
 * - `fillTemplate` replaces every `__GENERATE_<KIND>_<NAME>__` marker with
 *   a fresh secret. Markers sharing a NAME receive the SAME value, which
 *   keeps connection strings in sync with the passwords embedded in them.
 *   KINDs: HEX32 | HEX24 | PASSWORD | B64 | VAPID_PUBLIC | VAPID_PRIVATE
 *   (the VAPID pair is generated together).
 * - `mergeTemplate` is `helio update`'s append-only step: keys the user
 *   already has keep their values verbatim (comments included); keys new
 *   in this release are appended, with their markers filled.
 */

const MARKER = /__GENERATE_([A-Z0-9]+(?:_[A-Z0-9]+)*)__/g;

function valueForMarker(token: string, named: Map<string, string>): string {
  if (token === 'VAPID_PUBLIC' || token === 'VAPID_PRIVATE') {
    if (!named.has('VAPID_PUBLIC')) {
      const pair = generateVapidPair();
      named.set('VAPID_PUBLIC', pair.publicKey);
      named.set('VAPID_PRIVATE', pair.privateKey);
    }
    return named.get(token)!;
  }
  const existing = named.get(token);
  if (existing !== undefined) return existing;

  const [kind] = token.split('_', 1) as [string];
  let value: string;
  switch (kind) {
    case 'HEX32':
      value = generateHex(32);
      break;
    case 'HEX24':
      value = generateHex(24);
      break;
    case 'PASSWORD':
      value = generatePassword();
      break;
    case 'B64':
      value = generateVaultKey();
      break;
    default:
      throw new Error(`unknown secret marker kind in __GENERATE_${token}__`);
  }
  named.set(token, value);
  return value;
}

export function fillTemplate(template: string): { content: string; generated: string[] } {
  const named = new Map<string, string>();
  const content = template.replace(MARKER, (_match, token: string) => valueForMarker(token, named));
  return { content, generated: [...named.keys()] };
}

/** The keys defined (non-comment KEY= lines) in an env file. */
export function envKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (match) keys.add(match[1]!);
  }
  return keys;
}

/**
 * Append-only merge for updates: the user's file stays byte-identical;
 * template keys they don't have yet are appended (markers filled), under
 * a header naming the release that introduced them.
 */
export function mergeTemplate(
  existing: string,
  template: string,
  releaseTag: string,
): { content: string; added: string[] } {
  const have = envKeys(existing);
  const additions: string[] = [];
  const added: string[] = [];

  // Walk the template, keeping each new key together with the comment
  // block directly above it (its documentation).
  const lines = template.split('\n');
  let pendingComments: string[] = [];
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') {
      pendingComments.push(line);
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (match && !have.has(match[1]!)) {
      const comments = pendingComments.filter((entry) => entry.startsWith('#'));
      additions.push(...comments, line);
      added.push(match[1]!);
    }
    pendingComments = [];
  }

  if (added.length === 0) return { content: existing, added };
  const { content: filled } = fillTemplate(additions.join('\n'));
  const body = existing.endsWith('\n') ? existing : `${existing}\n`;
  return {
    content: `${body}\n# ── Added by helio update (${releaseTag}) ──\n${filled}\n`,
    added,
  };
}

/** Read one value out of an env file (no interpolation — literal). */
export function envValue(content: string, key: string): string | undefined {
  for (const line of content.split('\n')) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  }
  return undefined;
}
