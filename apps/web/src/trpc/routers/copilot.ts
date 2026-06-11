import { emailDocumentSchema, journeyDefinitionSchema, segmentRuleSchema } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { intelligence } from '@/lib/intelligence';

import { orgProcedure, router } from '../init';

/** Parse an AI draft against the canonical schema; an invalid draft is a
 *  retryable user-facing condition (rephrase), never a 500. */
function parseDraft<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new TRPCError({
      code: 'UNPROCESSABLE_CONTENT',
      message: 'The AI returned a draft Helio could not validate — try rephrasing your request.',
    });
  }
}

/**
 * The copilot BFF: proxies to the intelligence service, injecting the
 * caller's *verified* organization (from the session) and workspace — the
 * model never picks the tenant. Drafts are returned for review; saving
 * goes through the normal segment/journey routers, which re-validate.
 */
export const copilotRouter = router({
  /** Which AI provider serves this org — null when the AI plane is down. */
  providerInfo: orgProcedure.query(async ({ ctx }) => {
    try {
      return await intelligence.llmInfo({ organization_id: ctx.organizationId });
    } catch {
      return null;
    }
  }),

  chat: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        messages: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string().min(1).max(8000),
            }),
          )
          .min(1)
          .max(40),
      }),
    )
    .mutation(({ ctx, input }) =>
      intelligence.chat({
        organization_id: ctx.organizationId,
        workspace_id: input.workspaceId,
        messages: input.messages,
      }),
    ),

  draftSegment: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), prompt: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await intelligence.draftSegment({
        organization_id: ctx.organizationId,
        workspace_id: input.workspaceId,
        prompt: input.prompt,
      });
      // Re-validate against the canonical schema before trusting it.
      const rule = parseDraft(segmentRuleSchema, draft.rule);
      return { name: draft.name, rule };
    }),

  draftJourney: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), prompt: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await intelligence.draftJourney({
        organization_id: ctx.organizationId,
        workspace_id: input.workspaceId,
        prompt: input.prompt,
      });
      const definition = parseDraft(journeyDefinitionSchema, draft.definition);
      return { name: draft.name, definition };
    }),

  draftEmail: orgProcedure
    .input(z.object({ workspaceId: z.string().min(1), prompt: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await intelligence.draftEmail({
        organization_id: ctx.organizationId,
        workspace_id: input.workspaceId,
        prompt: input.prompt,
      });
      const document = parseDraft(emailDocumentSchema, draft.document);
      return { name: draft.name, subject: draft.subject, document };
    }),
});
