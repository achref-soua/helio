import {
  CHURN_FEATURE_NAMES,
  type ChurnFeatureMapping,
  churnFeatureMappingSchema,
  encryptField,
  newId,
  secretLast4,
} from '@helio/core';
import { Prisma } from '@helio/db';
import { type inferProcedureBuilderResolverOptions, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { decryptCredentialField } from '@/lib/credential-secrets';
import { env } from '@/lib/env';
import { intelligence, type ModelVerdict } from '@/lib/intelligence';

import { orgProcedure, requirePermission, router } from '../init';

/**
 * Bring-your-own churn models (ADR-0021). The dashboard owns the rows and
 * the lifecycle (VALIDATING → ready/FAILED → ACTIVE); the intelligence
 * service owns the artifact bytes and renders the verdicts. Endpoint auth
 * headers live in the credential vault and never travel back to clients.
 *
 * Lifecycle: a validation verdict of ok lands a model on DISABLED
 * ("ready"); Activate is an explicit, transactional swap — exactly one
 * ACTIVE model per workspace. FAILED models keep the reason on the row
 * and must re-validate before they can be activated again.
 */

type OrgCtx = inferProcedureBuilderResolverOptions<typeof orgProcedure>['ctx'];

const mappingInput = z.object({
  inputs: z.array(z.enum(CHURN_FEATURE_NAMES)).min(1),
});

function parseMapping(raw: unknown): ChurnFeatureMapping {
  const result = churnFeatureMappingSchema.safeParse(raw);
  if (result.success) return result.data;
  return { inputs: [...CHURN_FEATURE_NAMES], output: { kind: 'probability', positiveIndex: 1 } };
}

/** Apply a verdict to a model row: ok ⇒ ready (DISABLED), else FAILED. */
function verdictData(verdict: ModelVerdict) {
  return verdict.ok
    ? { status: 'DISABLED' as const, lastError: null, validatedAt: new Date() }
    : { status: 'FAILED' as const, lastError: verdict.error ?? 'validation failed' };
}

/** Intelligence-down and similar conditions become a FAILED row, not a 500. */
function verdictFromError(error: unknown): ModelVerdict {
  if (error instanceof TRPCError && error.code !== 'INTERNAL_SERVER_ERROR') {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: 'validation errored — check the intelligence service logs' };
}

async function revalidateRow(
  ctx: OrgCtx,
  model: {
    id: string;
    format: string;
    endpointUrl: string | null;
    credentialId: string | null;
    featureMapping: unknown;
  },
): Promise<ModelVerdict> {
  const mapping = parseMapping(model.featureMapping);
  try {
    if (model.format === 'HTTP') {
      if (!model.endpointUrl) return { ok: false, error: 'the model has no endpoint URL' };
      const authHeader = model.credentialId
        ? await decryptCredentialField(ctx, model.credentialId, 'authHeader')
        : undefined;
      return await intelligence.validateModelEndpoint({
        organization_id: ctx.organizationId,
        url: model.endpointUrl,
        auth_header: authHeader,
        inputs: mapping.inputs,
      });
    }
    return await intelligence.validateModelArtifact({
      organization_id: ctx.organizationId,
      model_id: model.id,
      format: model.format,
      n_inputs: mapping.inputs.length,
    });
  } catch (error) {
    return verdictFromError(error);
  }
}

export const churnModelRouter = router({
  list: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:churn-model');
      const rows = await ctx.tenantDb.churnModel.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        featureNames: [...CHURN_FEATURE_NAMES],
        models: rows.map((row) => ({
          id: row.id,
          name: row.name,
          format: row.format,
          filename: row.filename,
          sizeBytes: row.sizeBytes,
          endpointUrl: row.endpointUrl,
          status: row.status,
          lastError: row.lastError,
          validatedAt: row.validatedAt,
          createdAt: row.createdAt,
          mapping: parseMapping(row.featureMapping),
        })),
      };
    }),

  registerHttp: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(1).max(120),
        url: z.string().trim().url().max(500),
        authHeader: z.string().trim().max(2000).optional(),
        mapping: mappingInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:churn-model');
      const mapping = churnFeatureMappingSchema.parse(input.mapping);
      const modelId = newId('chm');

      // The endpoint's Authorization header is a secret: seal it into the
      // vault as a CHURN_ENDPOINT credential owned by this model.
      let credentialId: string | undefined;
      if (input.authHeader) {
        if (!env.HELIO_ENCRYPTION_KEY) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'HELIO_ENCRYPTION_KEY is not configured on this deployment',
          });
        }
        credentialId = newId('cred');
        await ctx.tenantDb.providerCredential.create({
          data: {
            id: credentialId,
            organizationId: ctx.organizationId,
            kind: 'CHURN_ENDPOINT',
            name: `churn model: ${input.name}`.slice(0, 120),
            config: { url: input.url },
            secrets: {
              authHeader: await encryptField(
                input.authHeader,
                {
                  organizationId: ctx.organizationId,
                  credentialId,
                  field: 'authHeader',
                },
                env.HELIO_ENCRYPTION_KEY,
              ),
            },
            secretsMeta: {
              authHeader: { last4: secretLast4(input.authHeader), setAt: new Date().toISOString() },
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      let verdict: ModelVerdict;
      try {
        verdict = await intelligence.validateModelEndpoint({
          organization_id: ctx.organizationId,
          url: input.url,
          auth_header: input.authHeader,
          inputs: mapping.inputs,
        });
      } catch (error) {
        verdict = verdictFromError(error);
      }

      try {
        const row = await ctx.tenantDb.churnModel.create({
          data: {
            id: modelId,
            organizationId: ctx.organizationId,
            workspaceId: input.workspaceId,
            name: input.name,
            format: 'HTTP',
            endpointUrl: input.url,
            credentialId,
            featureMapping: mapping as Prisma.InputJsonValue,
            ...verdictData(verdict),
          },
        });
        await writeAudit(ctx, input.workspaceId, 'churn_model.registered', row.id, row.name);
        return { id: row.id, status: row.status, lastError: row.lastError };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A model with this name already exists in this workspace',
          });
        }
        throw error;
      }
    }),

  updateMapping: orgProcedure
    .input(z.object({ id: z.string().min(1), mapping: mappingInput }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:churn-model');
      const mapping = churnFeatureMappingSchema.parse(input.mapping);
      const existing = await ctx.tenantDb.churnModel.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found' });

      const verdict = await revalidateRow(ctx, { ...existing, featureMapping: mapping });
      const row = await ctx.tenantDb.churnModel.update({
        where: { id: existing.id },
        data: { featureMapping: mapping as Prisma.InputJsonValue, ...verdictData(verdict) },
      });
      await writeAudit(ctx, existing.workspaceId, 'churn_model.mapping_updated', row.id, row.name);
      return { id: row.id, status: row.status, lastError: row.lastError };
    }),

  revalidate: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:churn-model');
      const existing = await ctx.tenantDb.churnModel.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found' });

      const wasActive = existing.status === 'ACTIVE';
      const verdict = await revalidateRow(ctx, existing);
      // An ACTIVE model that re-validates fine stays ACTIVE.
      const data =
        verdict.ok && wasActive
          ? { status: 'ACTIVE' as const, lastError: null, validatedAt: new Date() }
          : verdictData(verdict);
      const row = await ctx.tenantDb.churnModel.update({
        where: { id: existing.id },
        data,
      });
      await writeAudit(ctx, existing.workspaceId, 'churn_model.revalidated', row.id, row.name);
      return { id: row.id, status: row.status, lastError: row.lastError };
    }),

  activate: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:churn-model');
      const existing = await ctx.tenantDb.churnModel.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found' });
      if (existing.status === 'FAILED' || !existing.validatedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Validate the model successfully before activating it',
        });
      }
      // Exactly one ACTIVE model per workspace, atomically.
      await ctx.tenantDb.$transaction([
        ctx.tenantDb.churnModel.updateMany({
          where: { workspaceId: existing.workspaceId, status: 'ACTIVE', id: { not: existing.id } },
          data: { status: 'DISABLED' },
        }),
        ctx.tenantDb.churnModel.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', lastError: null },
        }),
      ]);
      await writeAudit(
        ctx,
        existing.workspaceId,
        'churn_model.activated',
        existing.id,
        existing.name,
      );
      return { id: existing.id, status: 'ACTIVE' as const };
    }),

  disable: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:churn-model');
      const existing = await ctx.tenantDb.churnModel.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found' });
      await ctx.tenantDb.churnModel.update({
        where: { id: existing.id },
        data: { status: 'DISABLED' },
      });
      await writeAudit(
        ctx,
        existing.workspaceId,
        'churn_model.disabled',
        existing.id,
        existing.name,
      );
      return { id: existing.id, status: 'DISABLED' as const };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:churn-model');
      const existing = await ctx.tenantDb.churnModel.findUnique({ where: { id: input.id } });
      if (!existing) return { ok: true };

      await ctx.tenantDb.churnModel.delete({ where: { id: existing.id } });
      // Tidy the artifact bytes and the model-owned credential; both are
      // best-effort — a missing intelligence service must not block delete.
      if (existing.format !== 'HTTP') {
        await intelligence
          .deleteModelArtifact({ organization_id: ctx.organizationId, model_id: existing.id })
          .catch(() => undefined);
      }
      if (existing.credentialId) {
        const stillUsed = await ctx.tenantDb.churnModel.count({
          where: { credentialId: existing.credentialId },
        });
        if (stillUsed === 0) {
          await ctx.tenantDb.providerCredential
            .delete({ where: { id: existing.credentialId } })
            .catch(() => undefined);
        }
      }
      await writeAudit(
        ctx,
        existing.workspaceId,
        'churn_model.deleted',
        existing.id,
        existing.name,
      );
      return { ok: true };
    }),
});

async function writeAudit(
  ctx: OrgCtx,
  workspaceId: string,
  action: string,
  targetId: string,
  name: string,
) {
  await ctx.tenantDb.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId: ctx.organizationId,
      workspaceId,
      actorId: ctx.session.user.id,
      action,
      targetType: 'churn_model',
      targetId,
      metadata: { name },
    },
  });
}
