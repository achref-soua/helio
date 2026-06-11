import { contactEmailSchema, newId } from '@helio/core';
import { type Contact, forTenant } from '@helio/db';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';

import type { GatewayDeps, GatewayEnv } from '../types';

// Mirrors @helio/db's ContactStatus enum; kept inline so the generated
// OpenAPI lists the literals without coupling the schema to Prisma's runtime.
const ContactStatusSchema = z.enum(['ACTIVE', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED']);

const ContactSchema = z
  .object({
    id: z.string().openapi({ example: 'contact_01jx3ye5k8f5rv9t6n0c2qme7a' }),
    organizationId: z.string(),
    workspaceId: z.string(),
    email: z.string().email(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    // Stored as JSON; the dashboard writes string values but journey
    // trait-updates can write any JSON, so the contract is permissive.
    attributes: z.record(z.string(), z.unknown()),
    status: ContactStatusSchema,
    score: z.number().int(),
    conversionProbability: z.number().nullable(),
    churnRisk: z.number().nullable(),
    bestSendHour: z.number().int().nullable(),
    source: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Contact');

const CreateContactBody = z
  .object({
    workspaceId: z.string().min(1).openapi({ example: 'ws_01jx3ye5k8f5rv9t6n0c2qme7a' }),
    email: z.string().email().max(254).openapi({ example: 'jane@example.com' }),
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    status: ContactStatusSchema.optional(),
  })
  .openapi('CreateContactRequest');

const UpdateContactBody = z
  .object({
    // null clears the field; omitted leaves it unchanged.
    firstName: z.string().trim().max(80).nullish(),
    lastName: z.string().trim().max(80).nullish(),
    // When present, replaces the whole attribute set.
    attributes: z.record(z.string(), z.string()).optional(),
    status: ContactStatusSchema.optional(),
  })
  .openapi('UpdateContactRequest');

const ListContactsQuery = z.object({
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .openapi({ param: { name: 'workspaceId', in: 'query' } }),
  listId: z
    .string()
    .min(1)
    .optional()
    .openapi({ param: { name: 'listId', in: 'query' } }),
  search: z
    .string()
    .trim()
    .max(120)
    .optional()
    .openapi({ param: { name: 'search', in: 'query' } }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .openapi({ param: { name: 'limit', in: 'query' } }),
  cursor: z
    .string()
    .min(1)
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
});

const ContactListResponse = z
  .object({
    data: z.array(ContactSchema),
    // The id to pass back as `cursor` for the next page; null on the last page.
    nextCursor: z.string().nullable(),
  })
  .openapi('ContactListResponse');

const IdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: 'id', in: 'path' }, example: 'contact_01jx3ye5k8f5rv9t6n0c2qme7a' }),
});

const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    instance: z.string().optional(),
  })
  .openapi('Problem');

const unauthorized = {
  401: {
    description: 'Missing or invalid credentials',
    content: { 'application/problem+json': { schema: ProblemSchema } },
  },
} as const;

const notFound = {
  404: {
    description: 'No such contact in this organization',
    content: { 'application/problem+json': { schema: ProblemSchema } },
  },
} as const;

const listRoute = createRoute({
  method: 'get',
  path: '/v1/contacts',
  tags: ['contacts'],
  summary: 'List contacts',
  description:
    'Cursor-paginated. Pass the returned `nextCursor` as `cursor` to fetch the next page. Optionally filter by workspace, list membership, or a name/email search.',
  request: { query: ListContactsQuery },
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'A page of contacts, newest first',
      content: { 'application/json': { schema: ContactListResponse } },
    },
    ...unauthorized,
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/contacts/{id}',
  tags: ['contacts'],
  summary: 'Retrieve a contact',
  request: { params: IdParam },
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'The contact', content: { 'application/json': { schema: ContactSchema } } },
    ...unauthorized,
    ...notFound,
  },
});

const createContactRoute = createRoute({
  method: 'post',
  path: '/v1/contacts',
  tags: ['contacts'],
  summary: 'Create a contact',
  description:
    'Supports idempotent retries via the Idempotency-Key header. Email is unique per workspace.',
  request: {
    body: { content: { 'application/json': { schema: CreateContactBody } }, required: true },
  },
  security: [{ bearerAuth: [] }],
  responses: {
    201: {
      description: 'The created contact',
      content: { 'application/json': { schema: ContactSchema } },
    },
    ...unauthorized,
    404: {
      description: 'The referenced workspace does not exist',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
    409: {
      description: 'A contact with this email already exists in the workspace',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
  },
});

const updateContactRoute = createRoute({
  method: 'patch',
  path: '/v1/contacts/{id}',
  tags: ['contacts'],
  summary: 'Update a contact',
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateContactBody } }, required: true },
  },
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'The updated contact',
      content: { 'application/json': { schema: ContactSchema } },
    },
    ...unauthorized,
    ...notFound,
  },
});

const deleteContactRoute = createRoute({
  method: 'delete',
  path: '/v1/contacts/{id}',
  tags: ['contacts'],
  summary: 'Delete a contact',
  description: 'Permanent (GDPR erasure); cascades list memberships. Idempotent on a missing id.',
  request: { params: IdParam },
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: 'Deleted' },
    ...unauthorized,
    ...notFound,
  },
});

function serialize(contact: Contact) {
  return {
    id: contact.id,
    organizationId: contact.organizationId,
    workspaceId: contact.workspaceId,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    attributes: (contact.attributes ?? {}) as Record<string, unknown>,
    status: contact.status,
    score: contact.score,
    conversionProbability: contact.conversionProbability,
    churnRisk: contact.churnRisk,
    bestSendHour: contact.bestSendHour,
    source: contact.source,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function contactRoutes(deps: GatewayDeps) {
  const app = new OpenAPIHono<GatewayEnv>();

  app.openapi(listRoute, async (c) => {
    const organizationId = c.get('organizationId');
    const { workspaceId, listId, search, limit, cursor } = c.req.valid('query');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const where = {
      ...(workspaceId ? { workspaceId } : {}),
      ...(listId ? { listMembers: { some: { listId } } } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const rows = await tenantDb.contact.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    // The +1th row only signals another page; the cursor is the last row we
    // keep (skip:1 then resumes at the row we popped).
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows.at(-1)!.id : null;
    return c.json({ data: rows.map(serialize), nextCursor }, 200);
  });

  app.openapi(getRoute, async (c) => {
    const organizationId = c.get('organizationId');
    const { id } = c.req.valid('param');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const contact = await tenantDb.contact.findUnique({ where: { id } });
    if (!contact) throw new HTTPException(404, { message: 'contact not found' });
    return c.json(serialize(contact), 200);
  });

  app.openapi(createContactRoute, async (c) => {
    const organizationId = c.get('organizationId');
    const input = c.req.valid('json');
    const tenantDb = forTenant(deps.prisma, organizationId);
    // Normalize (trim/lowercase) through the canonical email schema.
    const email = contactEmailSchema.parse(input.email);

    // RLS guarantees a found workspace is this org's; a miss is a 404.
    const workspace = await tenantDb.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new HTTPException(404, { message: 'workspace not found' });

    const existing = await tenantDb.contact.findFirst({
      where: { workspaceId: input.workspaceId, email },
    });
    if (existing) {
      throw new HTTPException(409, { message: 'a contact with this email already exists' });
    }

    const contact = await tenantDb.contact.create({
      data: {
        id: newId('contact'),
        organizationId,
        workspaceId: input.workspaceId,
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        attributes: input.attributes ?? {},
        status: input.status ?? 'ACTIVE',
        source: 'api',
      },
    });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: contact.workspaceId,
        action: 'contact.created',
        targetType: 'contact',
        targetId: contact.id,
        metadata: { via: 'gateway' },
      },
    });
    return c.json(serialize(contact), 201);
  });

  app.openapi(updateContactRoute, async (c) => {
    const organizationId = c.get('organizationId');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const existing = await tenantDb.contact.findUnique({ where: { id } });
    if (!existing) throw new HTTPException(404, { message: 'contact not found' });

    const contact = await tenantDb.contact.update({
      where: { id },
      data: {
        firstName: input.firstName === undefined ? undefined : input.firstName,
        lastName: input.lastName === undefined ? undefined : input.lastName,
        attributes: input.attributes,
        status: input.status,
      },
    });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: contact.workspaceId,
        action: 'contact.updated',
        targetType: 'contact',
        targetId: contact.id,
        metadata: { via: 'gateway' },
      },
    });
    return c.json(serialize(contact), 200);
  });

  app.openapi(deleteContactRoute, async (c) => {
    const organizationId = c.get('organizationId');
    const { id } = c.req.valid('param');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const existing = await tenantDb.contact.findUnique({ where: { id } });
    if (!existing) throw new HTTPException(404, { message: 'contact not found' });

    // Hard delete by design: GDPR erasure, cascades list memberships.
    await tenantDb.contact.delete({ where: { id } });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: existing.workspaceId,
        action: 'contact.deleted',
        targetType: 'contact',
        targetId: id,
        metadata: { via: 'gateway' },
      },
    });
    return c.body(null, 204);
  });

  return app;
}
