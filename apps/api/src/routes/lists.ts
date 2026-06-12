import { newId } from '@helio/core';
import { forTenant } from '@helio/db';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';

import { assertScope } from '../middleware/scopes';
import type { GatewayDeps, GatewayEnv } from '../types';

const ListSchema = z
  .object({
    id: z.string().openapi({ example: 'list_01jx3ye5k8f5rv9t6n0c2qme7a' }),
    organizationId: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    memberCount: z.number().int(),
    createdAt: z.string().datetime(),
  })
  .openapi('List');

const CreateListBody = z
  .object({
    workspaceId: z.string().min(1).openapi({ example: 'ws_01jx3ye5k8f5rv9t6n0c2qme7a' }),
    name: z.string().trim().min(1).max(80).openapi({ example: 'Newsletter subscribers' }),
  })
  .openapi('CreateListRequest');

const AddMembersBody = z
  .object({
    contactIds: z.array(z.string().min(1)).min(1).max(1000),
  })
  .openapi('AddListMembersRequest');

const AddMembersResponse = z
  .object({
    // How many memberships were created (already-members and ids that are not
    // contacts in this list's workspace are skipped).
    added: z.number().int(),
  })
  .openapi('AddListMembersResponse');

const ListContactListsQuery = z.object({
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .openapi({ param: { name: 'workspaceId', in: 'query' } }),
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

const ListsResponse = z
  .object({
    data: z.array(ListSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi('ListsResponse');

const IdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: 'id', in: 'path' }, example: 'list_01jx3ye5k8f5rv9t6n0c2qme7a' }),
});

const MemberParams = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: 'id', in: 'path' }, example: 'list_01jx3ye5k8f5rv9t6n0c2qme7a' }),
  contactId: z
    .string()
    .min(1)
    .openapi({ param: { name: 'contactId', in: 'path' }, example: 'contact_01jx3ye5k8f5rv9t6' }),
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
    description: 'No such list in this organization',
    content: { 'application/problem+json': { schema: ProblemSchema } },
  },
} as const;

const listRoute = createRoute({
  method: 'get',
  path: '/v1/lists',
  tags: ['lists'],
  summary: 'List contact lists',
  description: 'Cursor-paginated. Optionally filter by workspace.',
  request: { query: ListContactListsQuery },
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'A page of lists, newest first',
      content: { 'application/json': { schema: ListsResponse } },
    },
    ...unauthorized,
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/lists/{id}',
  tags: ['lists'],
  summary: 'Retrieve a list',
  request: { params: IdParam },
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'The list', content: { 'application/json': { schema: ListSchema } } },
    ...unauthorized,
    ...notFound,
  },
});

const createListRoute = createRoute({
  method: 'post',
  path: '/v1/lists',
  tags: ['lists'],
  summary: 'Create a list',
  description:
    'Supports idempotent retries via the Idempotency-Key header. Name is unique per workspace.',
  request: {
    body: { content: { 'application/json': { schema: CreateListBody } }, required: true },
  },
  security: [{ bearerAuth: [] }],
  responses: {
    201: {
      description: 'The created list',
      content: { 'application/json': { schema: ListSchema } },
    },
    ...unauthorized,
    404: {
      description: 'The referenced workspace does not exist',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
    409: {
      description: 'A list with this name already exists in the workspace',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
  },
});

const deleteListRoute = createRoute({
  method: 'delete',
  path: '/v1/lists/{id}',
  tags: ['lists'],
  summary: 'Delete a list',
  description: 'Cascades the list memberships (contacts themselves are untouched).',
  request: { params: IdParam },
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: 'Deleted' },
    ...unauthorized,
    ...notFound,
  },
});

const addMembersRoute = createRoute({
  method: 'post',
  path: '/v1/lists/{id}/members',
  tags: ['lists'],
  summary: 'Add contacts to a list',
  description:
    'Idempotent per contact: ids already in the list, or that are not contacts in this list’s workspace, are skipped.',
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: AddMembersBody } }, required: true },
  },
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'How many memberships were created',
      content: { 'application/json': { schema: AddMembersResponse } },
    },
    ...unauthorized,
    ...notFound,
  },
});

const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/v1/lists/{id}/members/{contactId}',
  tags: ['lists'],
  summary: 'Remove a contact from a list',
  request: { params: MemberParams },
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: 'Removed' },
    ...unauthorized,
    404: {
      description: 'The list does not exist or the contact is not a member',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
  },
});

function serialize(
  list: { id: string; organizationId: string; workspaceId: string; name: string; createdAt: Date },
  memberCount: number,
) {
  return {
    id: list.id,
    organizationId: list.organizationId,
    workspaceId: list.workspaceId,
    name: list.name,
    memberCount,
    createdAt: list.createdAt.toISOString(),
  };
}

export function listRoutes(deps: GatewayDeps) {
  const app = new OpenAPIHono<GatewayEnv>();

  app.openapi(listRoute, async (c) => {
    assertScope(c, 'lists:read');
    const organizationId = c.get('organizationId');
    const { workspaceId, limit, cursor } = c.req.valid('query');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const rows = await tenantDb.contactList.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      include: { _count: { select: { members: true } } },
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows.at(-1)!.id : null;
    return c.json({ data: rows.map((row) => serialize(row, row._count.members)), nextCursor }, 200);
  });

  app.openapi(getRoute, async (c) => {
    assertScope(c, 'lists:read');
    const organizationId = c.get('organizationId');
    const { id } = c.req.valid('param');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const list = await tenantDb.contactList.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
    if (!list) throw new HTTPException(404, { message: 'list not found' });
    return c.json(serialize(list, list._count.members), 200);
  });

  app.openapi(createListRoute, async (c) => {
    assertScope(c, 'lists:write');
    const organizationId = c.get('organizationId');
    const input = c.req.valid('json');
    const tenantDb = forTenant(deps.prisma, organizationId);

    const workspace = await tenantDb.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new HTTPException(404, { message: 'workspace not found' });

    const existing = await tenantDb.contactList.findFirst({
      where: { workspaceId: input.workspaceId, name: input.name },
    });
    if (existing) throw new HTTPException(409, { message: 'a list with this name already exists' });

    const list = await tenantDb.contactList.create({
      data: {
        id: newId('list'),
        organizationId,
        workspaceId: input.workspaceId,
        name: input.name,
      },
    });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: list.workspaceId,
        action: 'contact_list.created',
        targetType: 'contact_list',
        targetId: list.id,
        metadata: { via: 'gateway' },
      },
    });
    return c.json(serialize(list, 0), 201);
  });

  app.openapi(deleteListRoute, async (c) => {
    assertScope(c, 'lists:write');
    const organizationId = c.get('organizationId');
    const { id } = c.req.valid('param');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const existing = await tenantDb.contactList.findUnique({ where: { id } });
    if (!existing) throw new HTTPException(404, { message: 'list not found' });

    await tenantDb.contactList.delete({ where: { id } });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: existing.workspaceId,
        action: 'contact_list.deleted',
        targetType: 'contact_list',
        targetId: id,
        metadata: { via: 'gateway' },
      },
    });
    return c.body(null, 204);
  });

  app.openapi(addMembersRoute, async (c) => {
    assertScope(c, 'lists:write');
    const organizationId = c.get('organizationId');
    const { id } = c.req.valid('param');
    const { contactIds } = c.req.valid('json');
    const tenantDb = forTenant(deps.prisma, organizationId);

    const list = await tenantDb.contactList.findUnique({ where: { id } });
    if (!list) throw new HTTPException(404, { message: 'list not found' });

    // Only add ids that are real contacts in this list's workspace — the
    // public API is untrusted input, so never trust the ids blindly.
    const eligible = await tenantDb.contact.findMany({
      where: { id: { in: contactIds }, workspaceId: list.workspaceId },
      select: { id: true },
    });
    if (eligible.length === 0) return c.json({ added: 0 }, 200);

    const result = await tenantDb.contactListMember.createMany({
      data: eligible.map((contact) => ({ listId: id, contactId: contact.id, organizationId })),
      skipDuplicates: true,
    });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: list.workspaceId,
        action: 'contact_list.members_added',
        targetType: 'contact_list',
        targetId: id,
        metadata: { added: result.count, via: 'gateway' },
      },
    });
    return c.json({ added: result.count }, 200);
  });

  app.openapi(removeMemberRoute, async (c) => {
    assertScope(c, 'lists:write');
    const organizationId = c.get('organizationId');
    const { id, contactId } = c.req.valid('param');
    const tenantDb = forTenant(deps.prisma, organizationId);

    const list = await tenantDb.contactList.findUnique({ where: { id } });
    if (!list) throw new HTTPException(404, { message: 'list not found' });

    const removed = await tenantDb.contactListMember.deleteMany({
      where: { listId: id, contactId },
    });
    if (removed.count === 0) throw new HTTPException(404, { message: 'contact is not a member' });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: list.workspaceId,
        action: 'contact_list.member_removed',
        targetType: 'contact_list',
        targetId: id,
        metadata: { contactId, via: 'gateway' },
      },
    });
    return c.body(null, 204);
  });

  return app;
}
