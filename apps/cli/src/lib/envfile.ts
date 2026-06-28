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

/**
 * Set `KEY=value`, replacing the first existing definition in place (every
 * other line stays byte-identical) or appending it under a single trailing
 * newline. `changed` is false when the key already held that exact value, so
 * callers can stay idempotent.
 */
export function setEnvValue(
  content: string,
  key: string,
  value: string,
): { content: string; changed: boolean } {
  const line = `${key}=${value}`;
  const lines = content.split('\n');
  const index = lines.findIndex((entry) => entry.startsWith(`${key}=`));
  if (index !== -1) {
    if (lines[index] === line) return { content, changed: false };
    lines[index] = line;
    return { content: lines.join('\n'), changed: true };
  }
  const body = content.endsWith('\n') || content === '' ? content : `${content}\n`;
  return { content: `${body}${line}\n`, changed: true };
}

/** The COMPOSE_PROFILES list (comma-separated, trimmed); defaults to `full`. */
export function composeProfiles(content: string): string[] {
  return (envValue(content, 'COMPOSE_PROFILES') ?? 'full')
    .split(',')
    .map((profile) => profile.trim())
    .filter(Boolean);
}

/** Add or remove a single compose profile, preserving order and de-duping. */
export function withComposeProfile(
  content: string,
  profile: string,
  present: boolean,
): { content: string; changed: boolean } {
  const current = composeProfiles(content);
  const has = current.includes(profile);
  if (present === has) return { content, changed: false };
  const next = present ? [...current, profile] : current.filter((entry) => entry !== profile);
  return setEnvValue(content, 'COMPOSE_PROFILES', next.join(','));
}

/** The compose profile that runs the one-click-update sidecar. */
export const IN_APP_UPDATE_PROFILE = 'update';
/** Durable opt-out sentinel for `HELIO_INAPP_UPDATE` (web reads it as off). */
export const IN_APP_UPDATE_OPT_OUT = 'off';

export interface InAppUpdateReconcile {
  content: string;
  /** Whether the env content was modified. */
  changed: boolean;
  /** Whether in-app update is enabled after reconciliation. */
  enabled: boolean;
  /** Whether a durable opt-out is in effect (and was respected). */
  optedOut: boolean;
}

/**
 * Self-heal the one-click in-app-update wiring on `helio update`, idempotently.
 *
 * Installs predating v2.0.4 (or any that took `--no-inapp-update`) never gained
 * `HELIO_UPDATE_SECRET`, the `update` compose profile, or the toggle, so the
 * dashboard's Update button stayed off forever even after updating. This brings
 * the three back into line: toggle on, generate the secret if absent, add the
 * sidecar profile.
 *
 * Opt-out is durable and detectable: `--no-inapp-update` records
 * `HELIO_INAPP_UPDATE=off` and drops the profile, and that `off` is respected on
 * every later run unless the operator re-opts in (`--inapp-update`). A bare
 * `false` (the template default / a legacy merge) means "not configured yet" and
 * is enabled — that is what flips the button on for existing installs.
 */
export function reconcileInAppUpdate(
  content: string,
  opts: { optOut?: boolean; optIn?: boolean } = {},
): InAppUpdateReconcile {
  const current = envValue(content, 'HELIO_INAPP_UPDATE')?.trim();

  if (opts.optOut) {
    let next = setEnvValue(content, 'HELIO_INAPP_UPDATE', IN_APP_UPDATE_OPT_OUT).content;
    next = withComposeProfile(next, IN_APP_UPDATE_PROFILE, false).content;
    return { content: next, changed: next !== content, enabled: false, optedOut: true };
  }

  if (current === IN_APP_UPDATE_OPT_OUT && !opts.optIn) {
    return { content, changed: false, enabled: false, optedOut: true };
  }

  let next = setEnvValue(content, 'HELIO_INAPP_UPDATE', 'true').content;
  const secret = envValue(next, 'HELIO_UPDATE_SECRET')?.trim();
  if (!secret) next = setEnvValue(next, 'HELIO_UPDATE_SECRET', generateHex(32)).content;
  next = withComposeProfile(next, IN_APP_UPDATE_PROFILE, true).content;
  return { content: next, changed: next !== content, enabled: true, optedOut: false };
}
