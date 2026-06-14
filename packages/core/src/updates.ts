/**
 * The shape of an in-app update job, and a defensive parser for the status
 * the updater sidecar publishes to a shared volume. The dashboard polls this
 * across the restart an update causes, so parsing must never throw on a
 * partial or malformed read — it simply reports "no readable job" (null).
 */
export interface UpdateJobStatus {
  /**
   * Coarse phase: `requested` (dashboard queued it) → `starting` → `running`
   * → `done` | `failed`. Unknown strings are preserved and treated as live.
   */
  phase: string;
  /** The version the update landed on — set once `phase` is `done`. */
  version: string;
  /** The version that was requested. */
  targetVersion: string;
  /** A human-readable progress line. */
  message: string;
  /** ISO timestamp of the last status write. */
  updatedAt: string;
}

/** A finished job — nothing more will change. */
export function isTerminalUpdatePhase(phase: string): boolean {
  return phase === 'done' || phase === 'failed';
}

/** Parse a status.json payload, or null when it is missing/unusable. */
export function parseUpdateStatus(raw: string): UpdateJobStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const phase = record.phase;
  if (typeof phase !== 'string' || phase === '') return null;
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  return {
    phase,
    version: str(record.version),
    targetVersion: str(record.targetVersion),
    message: str(record.message),
    updatedAt: str(record.updatedAt),
  };
}
