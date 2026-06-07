import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access';

/**
 * Better-Auth access control for organization-level operations
 * (invitations, member management, org settings). Shared by server and
 * client so both validate the same role set: owner > admin > editor > viewer.
 *
 * Domain-level rights (what editors vs viewers may do to product data)
 * are enforced in tRPC via @helio/core's hasRole — this file only governs
 * Better-Auth's own org-management endpoints.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
  owner: ac.newRole(ownerAc.statements),
  admin: ac.newRole(adminAc.statements),
  // Editors and viewers are regular members for org-management purposes.
  editor: ac.newRole(memberAc.statements),
  viewer: ac.newRole(memberAc.statements),
};
