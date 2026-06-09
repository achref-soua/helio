import 'server-only';

import { hashScimToken, newId, type ScimUserInput } from '@helio/core';

import { authDb } from '@/lib/auth';

/**
 * SCIM provisioning store. SCIM is an identity protocol, so it runs against
 * the auth kernel's admin client (the RLS plane is denied identity tables).
 * A SCIM "User" maps to a membership in the token's organization: creating
 * one provisions the person into the org as a viewer; deactivating or
 * deleting one removes the membership (the underlying user, which may belong
 * to other orgs, is left intact).
 */

/** Resolve the org a SCIM bearer token belongs to, or null if invalid. */
export async function resolveScimOrg(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const tokenHash = await hashScimToken(match[1]!.trim());
  const row = await authDb.scimToken.findUnique({
    where: { tokenHash },
    select: { organizationId: true },
  });
  if (!row) return null;
  // Best-effort last-used stamp; never block the request on it.
  void authDb.scimToken
    .update({ where: { tokenHash }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return row.organizationId;
}

interface MemberWithUser {
  id: string;
  createdAt: Date;
  user: { email: string; name: string };
}

function toInput(member: MemberWithUser): ScimUserInput {
  return {
    id: member.id,
    email: member.user.email,
    active: true,
    displayName: member.user.name,
    createdAt: member.createdAt,
  };
}

/** List the org's members as SCIM users, optionally filtered by email. */
export async function listScimUsers(
  organizationId: string,
  email: string | null,
): Promise<ScimUserInput[]> {
  const members = await authDb.member.findMany({
    where: {
      organizationId,
      ...(email ? { user: { email: { equals: email, mode: 'insensitive' } } } : {}),
    },
    select: { id: true, createdAt: true, user: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return members.map(toInput);
}

/** Fetch one membership as a SCIM user, scoped to the org. */
export async function getScimUser(
  organizationId: string,
  memberId: string,
): Promise<ScimUserInput | null> {
  const member = await authDb.member.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, createdAt: true, user: { select: { email: true, name: true } } },
  });
  return member ? toInput(member) : null;
}

/**
 * Provision a user into the org. Idempotent on (org, email): if the person
 * is already a member, returns them with `created: false` so the caller can
 * answer 409. Otherwise creates the user (if new) and the membership.
 */
export async function provisionScimUser(
  organizationId: string,
  input: { email: string; displayName: string },
): Promise<{ created: boolean; user: ScimUserInput }> {
  const existingUser = await authDb.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true },
  });

  if (existingUser) {
    const existingMember = await authDb.member.findUnique({
      where: { organizationId_userId: { organizationId, userId: existingUser.id } },
      select: { id: true, createdAt: true },
    });
    if (existingMember) {
      return {
        created: false,
        user: { ...toInput({ ...existingMember, user: existingUser }) },
      };
    }
  }

  const user =
    existingUser ??
    (await authDb.user.create({
      data: {
        id: newId('user'),
        email: input.email,
        name: input.displayName,
        // Provisioned by a trusted IdP; the user signs in via SSO.
        emailVerified: true,
      },
      select: { id: true, email: true, name: true },
    }));

  const member = await authDb.member.create({
    data: { id: newId('member'), organizationId, userId: user.id, role: 'viewer' },
    select: { id: true, createdAt: true },
  });

  await authDb.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId,
      action: 'member.provisioned',
      targetType: 'member',
      targetId: member.id,
      metadata: { via: 'scim', email: user.email },
    },
  });

  return { created: true, user: toInput({ ...member, user }) };
}

/** Remove a membership (deprovision). Returns false if it wasn't in the org. */
export async function deprovisionScimUser(
  organizationId: string,
  memberId: string,
): Promise<boolean> {
  const { count } = await authDb.member.deleteMany({
    where: { id: memberId, organizationId },
  });
  if (count > 0) {
    await authDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        action: 'member.deprovisioned',
        targetType: 'member',
        targetId: memberId,
        metadata: { via: 'scim' },
      },
    });
  }
  return count > 0;
}
