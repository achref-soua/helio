import {
  displayNameFromScimUser,
  emailFromScimUser,
  parseUserNameFilter,
  scimListResponse,
  toScimUser,
} from '@helio/core';

import { listScimUsers, provisionScimUser } from '@/lib/scim';
import { scimBase, scimErrorResponse, scimJson, withScimOrg } from '@/lib/scim-http';

/** GET /scim/v2/Users — list org members, optionally `?filter=userName eq "…"`. */
export function GET(request: Request): Promise<Response> {
  return withScimOrg(request, async (organizationId) => {
    const url = new URL(request.url);
    const email = parseUserNameFilter(url.searchParams.get('filter'));
    const users = await listScimUsers(organizationId, email);
    const base = scimBase();
    return scimJson(
      scimListResponse(
        users.map((user) => toScimUser(user, `${base}/Users/${user.id}`)),
        users.length,
      ),
    );
  });
}

/** POST /scim/v2/Users — provision a member into the org. */
export function POST(request: Request): Promise<Response> {
  return withScimOrg(request, async (organizationId) => {
    const body: unknown = await request.json().catch(() => null);
    const email = emailFromScimUser(body);
    if (!email) {
      return scimErrorResponse(400, 'A userName or primary email is required.', 'invalidValue');
    }
    const displayName = displayNameFromScimUser(body, email);
    const { created, user } = await provisionScimUser(organizationId, { email, displayName });
    const base = scimBase();
    const resource = toScimUser(user, `${base}/Users/${user.id}`);
    if (!created) {
      return scimErrorResponse(409, 'User already provisioned in this organization.', 'uniqueness');
    }
    return scimJson(resource, 201, { location: `${base}/Users/${user.id}` });
  });
}
