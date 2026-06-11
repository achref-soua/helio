import { protectedProcedure, publicProcedure, router } from '../init';
import { analyticsRouter } from './analytics';
import { apiKeyRouter } from './api-key';
import { brandingRouter } from './branding';
import { campaignRouter } from './campaign';
import { contactRouter } from './contact';
import { contactListRouter } from './contact-list';
import { copilotRouter } from './copilot';
import { crmRouter } from './crm';
import { deliverabilityRouter } from './deliverability';
import { emailTemplateRouter } from './email-template';
import { formRouter } from './form';
import { inAppMessageRouter } from './inAppMessage';
import { integrationsRouter } from './integrations';
import { journeyRouter } from './journey';
import { landingRouter } from './landing';
import { schedulingRouter } from './scheduling';
import { scoringRouter } from './scoring';
import { segmentRouter } from './segment';
import { ssoRouter } from './sso';
import { supportRouter } from './support';
import { webhookRouter } from './webhook';
import { widgetRouter } from './widget';
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
  landing: landingRouter,
  scoring: scoringRouter,
  scheduling: schedulingRouter,
  crm: crmRouter,
  sso: ssoRouter,
  apiKey: apiKeyRouter,
  webhook: webhookRouter,
  branding: brandingRouter,
  integrations: integrationsRouter,
  support: supportRouter,
  deliverability: deliverabilityRouter,
  widget: widgetRouter,
  inAppMessage: inAppMessageRouter,
});

export type AppRouter = typeof appRouter;
