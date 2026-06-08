import { emailDocumentSchema, journeyDefinitionSchema, segmentRuleSchema } from '@helio/core';
import { z } from 'zod';

import { intelligence } from '@/lib/intelligence';

import { orgProcedure, router } from '../init';

/**
 * The copilot BFF: proxies to the intelligence service, injecting the
 * caller's *verified* organization (from the session) and workspace — the
 * model never picks the tenant. Drafts are returned for review; saving
 * goes through the normal segment/journey routers, which re-validate.
 */
export const copilotRouter = router({
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
      const rule = segmentRuleSchema.parse(draft.rule);
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
      const definition = journeyDefinitionSchema.parse(draft.definition);
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
      const document = emailDocumentSchema.parse(draft.document);
      return { name: draft.name, subject: draft.subject, document };
    }),
});
