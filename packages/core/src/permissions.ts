import { hasRole, type Role, ROLES } from './rbac';

/**
 * The application permission catalog. Every gated action has a name here,
 * and every name maps to the minimum role that may perform it — the four
 * roles are strictly ordered (viewer < editor < admin < owner), so a
 * minimum-role mapping IS the full role→permission matrix, in a shape
 * that is easy to audit and impossible to leave incomplete (the Record
 * type fails to compile if a permission has no entry).
 *
 * Routers gate with `requirePermission(role, 'campaigns:manage')` instead
 * of a bare role so the admin area (and the docs) can answer "who can do
 * what" by name, and so a future custom-role builder has a stable
 * vocabulary to assign.
 */
export const PERMISSIONS = [
  // Content & marketing (editors run the workspace day to day).
  'contacts:write',
  'contacts:export',
  'lists:write',
  'segments:write',
  'templates:write',
  'campaigns:manage',
  'journeys:manage',
  'forms:write',
  'landing:write',
  'widgets:write',
  'inapp:write',
  'crm:write',
  'scheduling:write',
  'scoring:manage',
  'analytics:sql',
  'workspaces:create',
  // Organization configuration (admins).
  'settings:workspace',
  'settings:credentials',
  'settings:sso',
  'settings:api-keys',
  'settings:webhooks',
  'settings:integrations',
  'settings:branding',
  'settings:deliverability',
  'settings:churn-model',
  'settings:support',
  // The admin area (admins; declared here so the matrix is complete
  // before the pages land).
  'admin:audit',
  'admin:reports',
  'admin:health',
  'admin:database',
  // Instance-critical operations (owners only).
  'admin:backups',
  'admin:updates',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MIN_ROLE: Record<Permission, Role> = {
  'contacts:write': 'editor',
  'contacts:export': 'editor',
  'lists:write': 'editor',
  'segments:write': 'editor',
  'templates:write': 'editor',
  'campaigns:manage': 'editor',
  'journeys:manage': 'editor',
  'forms:write': 'editor',
  'landing:write': 'editor',
  'widgets:write': 'editor',
  'inapp:write': 'editor',
  'crm:write': 'editor',
  'scheduling:write': 'editor',
  'scoring:manage': 'editor',
  'analytics:sql': 'editor',
  'workspaces:create': 'editor',
  'settings:workspace': 'admin',
  'settings:credentials': 'admin',
  'settings:sso': 'admin',
  'settings:api-keys': 'admin',
  'settings:webhooks': 'admin',
  'settings:integrations': 'admin',
  'settings:branding': 'admin',
  'settings:deliverability': 'admin',
  'settings:churn-model': 'admin',
  'settings:support': 'admin',
  'admin:audit': 'admin',
  'admin:reports': 'admin',
  'admin:health': 'admin',
  'admin:database': 'admin',
  'admin:backups': 'owner',
  'admin:updates': 'owner',
};

/** Minimum role required for a permission (drives the docs matrix). */
export function minimumRoleFor(permission: Permission): Role {
  return MIN_ROLE[permission];
}

/** True when the role string grants the permission. Unknown roles never pass. */
export function can(role: string, permission: Permission): boolean {
  return hasRole(role, MIN_ROLE[permission]);
}

/** Every permission the role grants — what the admin UI and docs render. */
export function permissionsForRole(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => can(role, permission));
}

/** The full matrix, role by role — single source for the docs table. */
export function permissionMatrix(): Record<Role, Permission[]> {
  return Object.fromEntries(ROLES.map((role) => [role, permissionsForRole(role)])) as Record<
    Role,
    Permission[]
  >;
}
