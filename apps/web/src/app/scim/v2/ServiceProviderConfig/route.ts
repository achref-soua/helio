import { scimJson } from '@/lib/scim-http';

/** SCIM 2.0 service provider capabilities (RFC 7643 §5). Unauthenticated —
 * it advertises features only, no tenant data. */
export function GET(): Response {
  return scimJson({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://github.com/achref-soua/helio/blob/main/docs/sso.md',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication using the SCIM bearer token issued in Helio settings.',
        primary: true,
      },
    ],
  });
}
