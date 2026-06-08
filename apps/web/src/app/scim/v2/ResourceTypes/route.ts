import { SCIM_USER_SCHEMA, scimListResponse } from '@helio/core';

import { scimBase, scimJson } from '@/lib/scim-http';

/** SCIM resource types we expose (RFC 7643 §6). Users only. */
export function GET(): Response {
  const base = scimBase();
  return scimJson(
    scimListResponse(
      [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'A member of the organization.',
          schema: SCIM_USER_SCHEMA,
          meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
        },
      ],
      1,
    ),
  );
}
