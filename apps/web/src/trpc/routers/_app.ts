import { protectedProcedure, publicProcedure, router } from '../init';
import { contactRouter } from './contact';
import { contactListRouter } from './contact-list';
import { workspaceRouter } from './workspace';

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  me: protectedProcedure.query(({ ctx }) => ({
    user: ctx.session.user,
    activeOrganizationId: ctx.session.session.activeOrganizationId ?? null,
  })),
  workspace: workspaceRouter,
  contact: contactRouter,
  contactList: contactListRouter,
});

export type AppRouter = typeof appRouter;
