/**
 * Organization roles, ordered by privilege. Better-Auth stores the role
 * string on the membership; this module is the single source of truth for
 * what each role may do at the application layer.
 */
export const ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * True when `actual` grants at least the privileges of `required`.
 * Unknown role strings never pass.
 */
export function hasRole(actual: string, required: Role): boolean {
  if (!isRole(actual)) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Roles that may be assigned through an invitation. Ownership transfers are explicit. */
export const INVITABLE_ROLES = ['viewer', 'editor', 'admin'] as const satisfies readonly Role[];
