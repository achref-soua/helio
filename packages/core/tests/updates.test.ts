import { describe, expect, it } from 'vitest';

import { isTerminalUpdatePhase, parseUpdateStatus } from '../src/updates';

describe('parseUpdateStatus', () => {
  it('reads a well-formed status', () => {
    const status = parseUpdateStatus(
      JSON.stringify({
        phase: 'done',
        version: 'v2.0.5',
        targetVersion: 'v2.0.5',
        message: 'Updated to v2.0.5.',
        updatedAt: '2026-06-14T00:00:00Z',
      }),
    );
    expect(status).toEqual({
      phase: 'done',
      version: 'v2.0.5',
      targetVersion: 'v2.0.5',
      message: 'Updated to v2.0.5.',
      updatedAt: '2026-06-14T00:00:00Z',
    });
  });

  it('preserves an unknown phase (treated as a live job upstream)', () => {
    expect(parseUpdateStatus('{"phase":"pulling"}')?.phase).toBe('pulling');
  });

  it('fills missing fields with empty strings', () => {
    const status = parseUpdateStatus('{"phase":"running"}');
    expect(status).toEqual({
      phase: 'running',
      version: '',
      targetVersion: '',
      message: '',
      updatedAt: '',
    });
  });

  it('returns null for malformed or empty input', () => {
    expect(parseUpdateStatus('not json')).toBeNull();
    expect(parseUpdateStatus('')).toBeNull();
    expect(parseUpdateStatus('null')).toBeNull();
    expect(parseUpdateStatus('[1,2,3]')).toBeNull();
  });

  it('returns null when the phase is missing or blank', () => {
    expect(parseUpdateStatus('{"version":"v2.0.5"}')).toBeNull();
    expect(parseUpdateStatus('{"phase":""}')).toBeNull();
    expect(parseUpdateStatus('{"phase":5}')).toBeNull();
  });

  it('ignores non-string field types', () => {
    const status = parseUpdateStatus('{"phase":"done","version":42,"message":null}');
    expect(status).toEqual({
      phase: 'done',
      version: '',
      targetVersion: '',
      message: '',
      updatedAt: '',
    });
  });
});

describe('isTerminalUpdatePhase', () => {
  it('is true only for done and failed', () => {
    expect(isTerminalUpdatePhase('done')).toBe(true);
    expect(isTerminalUpdatePhase('failed')).toBe(true);
    expect(isTerminalUpdatePhase('running')).toBe(false);
    expect(isTerminalUpdatePhase('requested')).toBe(false);
    expect(isTerminalUpdatePhase('')).toBe(false);
  });
});
