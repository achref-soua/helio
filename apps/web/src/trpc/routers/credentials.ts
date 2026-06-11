import {
  type CredentialKind,
  credentialSpec,
  decryptField,
  encryptField,
  newId,
  secretLast4,
  type SecretsMeta,
  toMaskedCredential,
  validateCredentialInput,
} from '@helio/core';
import { Prisma } from '@helio/db';
import { type inferProcedureBuilderResolverOptions, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { runCredentialProbe } from '@/lib/credential-verify';
import { env } from '@/lib/env';
import { senderFromCredentialRow } from '@/lib/mailer';

import { orgProcedure, requireRole, router } from '../init';

/**
 * The org credential vault (ADR-0019). Secrets are sealed into enc:v1
 * envelopes before they touch the database and NEVER travel back out:
 * every read uses MASKED_SELECT, and display masks come from the
 * write-time `secretsMeta` only.
 */
const MASKED_SELECT = {
  id: true,
  kind: true,
  name: true,
  config: true,
  secretsMeta: true,
  status: true,
  lastVerifiedAt: true,
  lastError: true,
  updatedAt: true,
} as const;

type OrgCtx = inferProcedureBuilderResolverOptions<typeof orgProcedure>['ctx'];

function encryptionKeys(): { key: string; previous?: string } {
  if (!env.HELIO_ENCRYPTION_KEY) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'HELIO_ENCRYPTION_KEY is not configured on this deployment',
    });
  }
  return { key: env.HELIO_ENCRYPTION_KEY, previous: env.HELIO_ENCRYPTION_KEY_PREVIOUS };
}

function maskRow(row: {
  id: string;
  kind: string;
  name: string;
  config: unknown;
  secretsMeta: unknown;
  status: string;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}) {
  return toMaskedCredential({
    ...row,
    kind: row.kind as CredentialKind,
    status: row.status as 'UNVERIFIED' | 'VERIFIED' | 'FAILED',
  });
}

const saveInput = z.object({
  id: z.string().min(1).optional(),
  kind: z.string(),
  name: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

export const credentialsRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    requireRole(ctx.memberRole, 'admin');
    const rows = await ctx.tenantDb.providerCredential.findMany({
      select: MASKED_SELECT,
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return {
      encryptionReady: Boolean(env.HELIO_ENCRYPTION_KEY),
      credentials: rows.map(maskRow),
    };
  }),

  save: orgProcedure.input(saveInput).mutation(async ({ ctx, input }) => {
    requireRole(ctx.memberRole, 'admin');
    const keys = encryptionKeys();

    let validated;
    try {
      validated = validateCredentialInput(
        { kind: input.kind, name: input.name, config: input.config, secrets: input.secrets },
        { requireSecrets: !input.id },
      );
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? (error.issues[0]?.message ?? 'invalid credential')
          : 'invalid credential';
      throw new TRPCError({ code: 'BAD_REQUEST', message });
    }

    const now = new Date().toISOString();
    const credentialId = input.id ?? newId('cred');

    const sealed: Record<string, string> = {};
    const meta: SecretsMeta = {};
    for (const [field, value] of Object.entries(validated.secrets)) {
      sealed[field] = await encryptField(
        value,
        { organizationId: ctx.organizationId, credentialId, field },
        keys.key,
      );
      meta[field] = { last4: secretLast4(value), setAt: now };
    }

    try {
      if (!input.id) {
        const row = await ctx.tenantDb.providerCredential.create({
          data: {
            id: credentialId,
            organizationId: ctx.organizationId,
            kind: validated.kind,
            name: validated.name,
            config: validated.config as Prisma.InputJsonValue,
            secrets: sealed as Prisma.InputJsonValue,
            secretsMeta: meta as unknown as Prisma.InputJsonValue,
          },
          select: MASKED_SELECT,
        });
        await writeAudit(ctx, 'credential.created', row.id, validated.kind, validated.name);
        return maskRow(row);
      }

      const existing = await ctx.tenantDb.providerCredential.findUnique({
        where: { id: input.id },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      if (existing.kind !== validated.kind) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A credential cannot change provider kind — create a new one instead',
        });
      }
      const mergedSecrets = {
        ...((existing.secrets ?? {}) as unknown as Record<string, string>),
        ...sealed,
      };
      const mergedMeta = {
        ...((existing.secretsMeta ?? {}) as unknown as SecretsMeta),
        ...meta,
      };
      const row = await ctx.tenantDb.providerCredential.update({
        where: { id: existing.id },
        data: {
          name: validated.name,
          config: validated.config as Prisma.InputJsonValue,
          secrets: mergedSecrets as Prisma.InputJsonValue,
          secretsMeta: mergedMeta as unknown as Prisma.InputJsonValue,
          status: 'UNVERIFIED',
          lastError: null,
        },
        select: MASKED_SELECT,
      });
      await writeAudit(ctx, 'credential.updated', row.id, validated.kind, validated.name);
      return maskRow(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A credential with this name already exists for this provider',
        });
      }
      throw error;
    }
  }),

  verify: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'admin');
      const keys = encryptionKeys();
      const existing = await ctx.tenantDb.providerCredential.findUnique({
        where: { id: input.id },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });

      const kind = existing.kind as CredentialKind;
      const stored = (existing.secrets ?? {}) as unknown as Record<string, string>;
      const secrets: Record<string, string> = {};
      let result: { ok: boolean; message: string };
      try {
        for (const field of credentialSpec(kind).secretFields) {
          const envelope = stored[field.name];
          if (!envelope) continue;
          secrets[field.name] = await decryptField(
            envelope,
            { organizationId: ctx.organizationId, credentialId: existing.id, field: field.name },
            keys.key,
            keys.previous,
          );
        }
        result = await runCredentialProbe(
          kind,
          (existing.config ?? {}) as Record<string, unknown>,
          secrets,
        );
      } catch {
        // Wrong/rotated deployment key: the stored value is unreadable.
        result = {
          ok: false,
          message: 'Stored secret cannot be decrypted on this deployment — re-enter it',
        };
      }

      const row = await ctx.tenantDb.providerCredential.update({
        where: { id: existing.id },
        data: {
          status: result.ok ? 'VERIFIED' : 'FAILED',
          lastVerifiedAt: result.ok ? new Date() : existing.lastVerifiedAt,
          lastError: result.ok ? null : result.message,
        },
        select: MASKED_SELECT,
      });
      await writeAudit(
        ctx,
        result.ok ? 'credential.verified' : 'credential.verify_failed',
        row.id,
        kind,
        existing.name,
      );
      return maskRow(row);
    }),

  /** Deliver a short real message through the credential, to the caller. */
  sendTest: orgProcedure
    .input(z.object({ id: z.string().min(1), to: z.string().email().optional() }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'admin');
      encryptionKeys();
      const existing = await ctx.tenantDb.providerCredential.findUnique({
        where: { id: input.id },
        select: { id: true, kind: true, name: true, config: true, secrets: true },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      if (!existing.kind.startsWith('EMAIL_')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Test sends are only available for email credentials',
        });
      }
      const to = input.to ?? ctx.session.user.email;
      try {
        const sender = await senderFromCredentialRow(ctx.organizationId, existing);
        await sender.send({
          to,
          subject: 'Helio test email',
          text: `This is a test from your "${existing.name}" email credential. If you can read this, sending works.`,
          html: `<p>This is a test from your "<b>${existing.name}</b>" email credential. If you can read this, sending works.</p>`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 200) : 'send failed';
        await writeAudit(
          ctx,
          'credential.test_failed',
          existing.id,
          existing.kind as CredentialKind,
          existing.name,
        );
        return { ok: false as const, to, message };
      }
      await writeAudit(
        ctx,
        'credential.test_sent',
        existing.id,
        existing.kind as CredentialKind,
        existing.name,
      );
      return { ok: true as const, to };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.memberRole, 'admin');
      const existing = await ctx.tenantDb.providerCredential.findUnique({
        where: { id: input.id },
        select: { id: true, kind: true, name: true },
      });
      if (!existing) return { ok: true };
      await ctx.tenantDb.providerCredential.delete({ where: { id: existing.id } });
      await writeAudit(
        ctx,
        'credential.deleted',
        existing.id,
        existing.kind as CredentialKind,
        existing.name,
      );
      return { ok: true };
    }),
});

async function writeAudit(
  ctx: OrgCtx,
  action: string,
  targetId: string,
  kind: CredentialKind,
  name: string,
) {
  await ctx.tenantDb.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId: ctx.organizationId,
      actorId: ctx.session.user.id,
      action,
      targetType: 'credential',
      targetId,
      metadata: { kind, name },
    },
  });
}
