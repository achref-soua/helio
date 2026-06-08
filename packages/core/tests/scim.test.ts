import { describe, expect, it } from 'vitest';

import {
  activeFromPatch,
  activeFromScimUser,
  displayNameFromScimUser,
  emailFromScimUser,
  generateScimToken,
  hashScimToken,
  parseUserNameFilter,
  SCIM_LIST_SCHEMA,
  SCIM_USER_SCHEMA,
  scimError,
  scimListResponse,
  toScimUser,
} from '../src/scim';

describe('toScimUser', () => {
  it('projects a membership into a SCIM core User', () => {
    const user = toScimUser(
      {
        id: 'mem_1',
        email: 'jo@acme.com',
        active: true,
        displayName: 'Jo Lee',
        createdAt: new Date('2026-06-08T00:00:00.000Z'),
      },
      'https://app/scim/v2/Users/mem_1',
    );
    expect(user.schemas).toEqual([SCIM_USER_SCHEMA]);
    expect(user.id).toBe('mem_1');
    expect(user.userName).toBe('jo@acme.com');
    expect(user.displayName).toBe('Jo Lee');
    expect(user.name).toEqual({ formatted: 'Jo Lee' });
    expect(user.emails).toEqual([{ value: 'jo@acme.com', primary: true }]);
    expect(user.active).toBe(true);
    expect(user.meta).toMatchObject({
      resourceType: 'User',
      location: 'https://app/scim/v2/Users/mem_1',
      created: '2026-06-08T00:00:00.000Z',
    });
  });

  it('omits name and created when absent', () => {
    const user = toScimUser({ id: 'm', email: 'x@y.com', active: false }, '/loc');
    expect(user.name).toBeUndefined();
    expect(user.displayName).toBeUndefined();
    expect(user.meta.created).toBeUndefined();
    expect(user.active).toBe(false);
  });
});

describe('scimListResponse', () => {
  it('wraps resources with totals', () => {
    const list = scimListResponse([{ id: 'a' }, { id: 'b' }], 2);
    expect(list.schemas).toEqual([SCIM_LIST_SCHEMA]);
    expect(list.totalResults).toBe(2);
    expect(list.itemsPerPage).toBe(2);
    expect(list.startIndex).toBe(1);
    expect(list.Resources).toHaveLength(2);
  });
});

describe('scimError', () => {
  it('mirrors the HTTP status as a string and carries scimType', () => {
    expect(scimError(409, 'exists', 'uniqueness')).toMatchObject({
      status: '409',
      detail: 'exists',
      scimType: 'uniqueness',
    });
  });
});

describe('parseUserNameFilter', () => {
  it('extracts the value from a userName eq filter', () => {
    expect(parseUserNameFilter('userName eq "a@b.com"')).toBe('a@b.com');
    expect(parseUserNameFilter('  userName   eq   "A@B.com"  ')).toBe('A@B.com');
  });
  it('returns null for unsupported or missing filters', () => {
    expect(parseUserNameFilter(null)).toBeNull();
    expect(parseUserNameFilter('')).toBeNull();
    expect(parseUserNameFilter('displayName eq "x"')).toBeNull();
    expect(parseUserNameFilter('userName sw "a"')).toBeNull();
  });
});

describe('activeFromPatch', () => {
  it('reads the Okta-style nested value', () => {
    expect(activeFromPatch({ Operations: [{ op: 'replace', value: { active: false } }] })).toBe(
      false,
    );
  });
  it('reads the path-style operation', () => {
    expect(activeFromPatch({ Operations: [{ op: 'replace', path: 'active', value: true }] })).toBe(
      true,
    );
  });
  it('coerces string booleans (Entra)', () => {
    expect(
      activeFromPatch({ Operations: [{ op: 'Replace', path: 'active', value: 'False' }] }),
    ).toBe(false);
  });
  it('returns null when no operation touches active', () => {
    expect(
      activeFromPatch({ Operations: [{ op: 'replace', path: 'name.givenName', value: 'X' }] }),
    ).toBeNull();
    expect(activeFromPatch({})).toBeNull();
    expect(activeFromPatch(null)).toBeNull();
  });
});

describe('emailFromScimUser', () => {
  it('prefers userName, then the primary email', () => {
    expect(emailFromScimUser({ userName: 'Jo@Acme.com' })).toBe('jo@acme.com');
    expect(
      emailFromScimUser({
        emails: [
          { value: 'alt@acme.com', primary: false },
          { value: 'Main@acme.com', primary: true },
        ],
      }),
    ).toBe('main@acme.com');
    expect(emailFromScimUser({ emails: [{ value: 'first@acme.com' }] })).toBe('first@acme.com');
  });
  it('returns null without an email', () => {
    expect(emailFromScimUser({ userName: 'no-at-sign' })).toBeNull();
    expect(emailFromScimUser({})).toBeNull();
  });
});

describe('displayName and active parsing', () => {
  it('derives a display name from displayName, formatted, or given+family', () => {
    expect(displayNameFromScimUser({ displayName: 'Full Name' }, 'x@acme.com')).toBe('Full Name');
    expect(displayNameFromScimUser({ name: { formatted: 'Jo Lee' } }, 'x@acme.com')).toBe('Jo Lee');
    expect(displayNameFromScimUser({ name: { givenName: 'Jo', familyName: 'Lee' } }, 'x@a')).toBe(
      'Jo Lee',
    );
  });
  it('falls back to the email local-part', () => {
    expect(displayNameFromScimUser({}, 'someone@acme.com')).toBe('someone');
  });
  it('defaults active to true', () => {
    expect(activeFromScimUser({})).toBe(true);
    expect(activeFromScimUser({ active: false })).toBe(false);
    expect(activeFromScimUser({ active: 'false' })).toBe(false);
  });
});

describe('SCIM tokens', () => {
  it('mints a prefixed token whose hash is stable and matchable', async () => {
    const { token, hash } = await generateScimToken();
    expect(token.startsWith('scim_')).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashScimToken(token)).toBe(hash);
  });
  it('produces distinct tokens and hashes', async () => {
    const a = await generateScimToken();
    const b = await generateScimToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});
