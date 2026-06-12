import { newId } from '@helio/core';
import { forTenant } from '@helio/db';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';

import { assertScope } from '../middleware/scopes';
import type { GatewayDeps, GatewayEnv } from '../types';

const WorkspaceSchema = z
  .object({
    id: z.string().openapi({ example: 'ws_01jx3ye5k8f5rv9t6n0c2qme7a' }),
    organizationId: z.string(),
    name: z.string(),
    slug: z.string(),
    createdAt: z.string().datetime(),
  })
  .openapi('Workspace');

const CreateWorkspaceBody = z
  .object({
    name: z.string().min(1).max(80),
    slug: z
      .string()
      .min(1)
      .max(48)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  })
  .openapi('CreateWorkspaceRequest');

const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    instance: z.string().optional(),
  })
  .openapi('Problem');

const listRoute = createRoute({
  method: 'get',
  path: '/v1/workspaces',
  tags: ['workspaces'],
  summary: "List the authenticated organization's workspaces",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Workspaces in creation order',
      content: { 'application/json': { schema: z.array(WorkspaceSchema) } },
    },
    401: {
      description: 'Missing or invalid credentials',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
  },
});

const createWorkspaceRoute = createRoute({
  method: 'post',
  path: '/v1/workspaces',
  tags: ['workspaces'],
  summary: 'Create a workspace',
  description:
    'Supports idempotent retries via the Idempotency-Key header: repeating a key replays the original response.',
  request: {
    body: { content: { 'application/json': { schema: CreateWorkspaceBody } }, required: true },
  },
  security: [{ bearerAuth: [] }],
  responses: {
    201: {
      description: 'Created workspace',
      content: { 'application/json': { schema: WorkspaceSchema } },
    },
    401: {
      description: 'Missing or invalid credentials',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
    409: {
      description: 'Slug already used in this organization',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
  },
});

function serialize(workspace: {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: Date;
}) {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    name: workspace.name,
    slug: workspace.slug,
    createdAt: workspace.createdAt.toISOString(),
  };
}

export function workspaceRoutes(deps: GatewayDeps) {
  const app = new OpenAPIHono<GatewayEnv>();

  app.openapi(listRoute, async (c) => {
    assertScope(c, 'workspaces:read');
    const organizationId = c.get('organizationId');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const workspaces = await tenantDb.workspace.findMany({ orderBy: { createdAt: 'asc' } });
    return c.json(workspaces.map(serialize), 200);
  });

  app.openapi(createWorkspaceRoute, async (c) => {
    assertScope(c, 'workspaces:write');
    const organizationId = c.get('organizationId');
    const input = c.req.valid('json');
    const tenantDb = forTenant(deps.prisma, organizationId);
    const existing = await tenantDb.workspace.findFirst({
      where: { slug: input.slug },
    });
    if (existing) {
      throw new HTTPException(409, { message: 'workspace slug already exists' });
    }
    const workspace = await tenantDb.workspace.create({
      data: {
        id: newId('ws'),
        organizationId,
        name: input.name,
        slug: input.slug,
      },
    });
    await tenantDb.auditLog.create({
      data: {
        id: newId('audit'),
        organizationId,
        workspaceId: workspace.id,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: workspace.id,
        metadata: { via: 'gateway' },
      },
    });
    return c.json(serialize(workspace), 201);
  });

  return app;
}
