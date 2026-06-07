import { protectedProcedure, publicProcedure, router } from '../init';
import { workspaceRouter } from './workspace';

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  me: protectedProcedure.query(({ ctx }) => ({
    user: ctx.session.user,
    activeOrganizationId: ctx.session.session.activeOrganizationId ?? null,
  })),
  workspace: workspaceRouter,
});

export type AppRouter = typeof appRouter;
