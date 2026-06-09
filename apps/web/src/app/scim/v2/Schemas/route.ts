import { SCIM_USER_SCHEMA, scimListResponse } from '@helio/core';

import { scimBase, scimJson } from '@/lib/scim-http';

/** The SCIM core User schema we support (RFC 7643 §8.7). */
export function GET(): Response {
  const base = scimBase();
  return scimJson(
    scimListResponse(
      [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
          id: SCIM_USER_SCHEMA,
          name: 'User',
          description: 'SCIM core User',
          attributes: [
            {
              name: 'userName',
              type: 'string',
              multiValued: false,
              required: true,
              caseExact: false,
              uniqueness: 'server',
            },
            { name: 'active', type: 'boolean', multiValued: false, required: false },
            { name: 'displayName', type: 'string', multiValued: false, required: false },
            {
              name: 'emails',
              type: 'complex',
              multiValued: true,
              required: false,
              subAttributes: [
                { name: 'value', type: 'string', multiValued: false, required: false },
                { name: 'primary', type: 'boolean', multiValued: false, required: false },
              ],
            },
          ],
          meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM_USER_SCHEMA}` },
        },
      ],
      1,
    ),
  );
}
