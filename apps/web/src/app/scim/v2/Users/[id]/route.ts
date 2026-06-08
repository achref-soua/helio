import { activeFromPatch, activeFromScimUser, toScimUser } from '@helio/core';

import { deprovisionScimUser, getScimUser } from '@/lib/scim';
import { scimBase, scimErrorResponse, scimJson, withScimOrg } from '@/lib/scim-http';

type Context = { params: Promise<{ id: string }> };

/** GET /scim/v2/Users/{id}. */
export function GET(request: Request, context: Context): Promise<Response> {
  return withScimOrg(request, async (organizationId) => {
    const { id } = await context.params;
    const user = await getScimUser(organizationId, id);
    if (!user) return scimErrorResponse(404, 'User not found.');
    return scimJson(toScimUser(user, `${scimBase()}/Users/${id}`));
  });
}

/**
 * PATCH /scim/v2/Users/{id} — the deactivation path IdPs use. Setting
 * `active: false` removes the org membership (Helio has no inactive
 * membership state); any other patch is a no-op we acknowledge.
 */
export function PATCH(request: Request, context: Context): Promise<Response> {
  return withScimOrg(request, async (organizationId) => {
    const { id } = await context.params;
    const user = await getScimUser(organizationId, id);
    if (!user) return scimErrorResponse(404, 'User not found.');
    const body: unknown = await request.json().catch(() => null);
    if (activeFromPatch(body) === false) {
      await deprovisionScimUser(organizationId, id);
      return scimJson(toScimUser({ ...user, active: false }, `${scimBase()}/Users/${id}`));
    }
    return scimJson(toScimUser(user, `${scimBase()}/Users/${id}`));
  });
}

/** PUT /scim/v2/Users/{id} — full replace; only `active` affects membership. */
export function PUT(request: Request, context: Context): Promise<Response> {
  return withScimOrg(request, async (organizationId) => {
    const { id } = await context.params;
    const user = await getScimUser(organizationId, id);
    if (!user) return scimErrorResponse(404, 'User not found.');
    const body: unknown = await request.json().catch(() => null);
    if (!activeFromScimUser(body)) {
      await deprovisionScimUser(organizationId, id);
      return scimJson(toScimUser({ ...user, active: false }, `${scimBase()}/Users/${id}`));
    }
    return scimJson(toScimUser(user, `${scimBase()}/Users/${id}`));
  });
}

/** DELETE /scim/v2/Users/{id} — deprovision the member. */
export function DELETE(request: Request, context: Context): Promise<Response> {
  return withScimOrg(request, async (organizationId) => {
    const { id } = await context.params;
    const removed = await deprovisionScimUser(organizationId, id);
    if (!removed) return scimErrorResponse(404, 'User not found.');
    return new Response(null, { status: 204 });
  });
}
