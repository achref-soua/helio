import { contactLimitFor, isValidPlan, type Plan, planSpec } from '@helio/core';
import { type inferProcedureBuilderResolverOptions } from '@trpc/server';
import { z } from 'zod';

import { orgProcedure, router } from '../init';

/** The RLS-bound Prisma client carried on the org-scoped context. */
export type TenantDb = inferProcedureBuilderResolverOptions<typeof orgProcedure>['ctx']['tenantDb'];

/**
 * Resolve an org's billing plan. Self-hosted orgs have no subscription row
 * and default to UNLIMITED — Helio never caps a deployment you run
 * yourself. Hosted orgs get a row maintained by the Stripe webhook.
 */
export async function resolvePlan(tenantDb: TenantDb, organizationId: string): Promise<Plan> {
  const subscription = await tenantDb.subscription.findUnique({
    where: { organizationId },
    select: { plan: true },
  });
  if (subscription && isValidPlan(subscription.plan)) return subscription.plan;
  return 'UNLIMITED';
}

export const billingRouter = router({
  /** Current plan, status, and contact usage for the billing settings page. */
  get: orgProcedure
    .input(
      z
        .object({ workspaceId: z.string().min(1) })
        .partial()
        .optional(),
    )
    .query(async ({ ctx }) => {
      const subscription = await ctx.tenantDb.subscription.findUnique({
        where: { organizationId: ctx.organizationId },
        select: { plan: true, status: true, currentPeriodEnd: true },
      });
      const plan: Plan =
        subscription && isValidPlan(subscription.plan) ? subscription.plan : 'UNLIMITED';
      // Usage is org-wide (contacts span all workspaces in the org).
      const contactUsage = await ctx.tenantDb.contact.count();
      return {
        plan,
        status: subscription?.status ?? null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
        contactLimit: contactLimitFor(plan),
        contactUsage,
        priceCents: planSpec(plan).priceCents,
      };
    }),
});
