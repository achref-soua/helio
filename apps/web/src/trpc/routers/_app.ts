import { protectedProcedure, publicProcedure, router } from '../init';
import { analyticsRouter } from './analytics';
import { apiKeyRouter } from './api-key';
import { billingRouter } from './billing';
import { brandingRouter } from './branding';
import { campaignRouter } from './campaign';
import { contactRouter } from './contact';
import { contactListRouter } from './contact-list';
import { copilotRouter } from './copilot';
import { crmRouter } from './crm';
import { emailTemplateRouter } from './email-template';
import { formRouter } from './form';
import { integrationsRouter } from './integrations';
import { journeyRouter } from './journey';
import { schedulingRouter } from './scheduling';
import { scoringRouter } from './scoring';
import { segmentRouter } from './segment';
import { ssoRouter } from './sso';
import { webhookRouter } from './webhook';
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
  campaign: campaignRouter,
  journey: journeyRouter,
  analytics: analyticsRouter,
  copilot: copilotRouter,
  form: formRouter,
  scoring: scoringRouter,
  scheduling: schedulingRouter,
  crm: crmRouter,
  billing: billingRouter,
  sso: ssoRouter,
  apiKey: apiKeyRouter,
  webhook: webhookRouter,
  branding: brandingRouter,
  integrations: integrationsRouter,
});

export type AppRouter = typeof appRouter;
