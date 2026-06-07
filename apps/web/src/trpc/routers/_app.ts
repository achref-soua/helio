import { protectedProcedure, publicProcedure, router } from '../init';
import { contactRouter } from './contact';
import { contactListRouter } from './contact-list';
import { emailTemplateRouter } from './email-template';
import { segmentRouter } from './segment';
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
  segment: segmentRouter,
  emailTemplate: emailTemplateRouter,
});

export type AppRouter = typeof appRouter;
