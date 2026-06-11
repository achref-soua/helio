import { authDb } from '@/lib/auth';

import { protectedProcedure, publicProcedure, router } from '../init';
import { analyticsRouter } from './analytics';
import { apiKeyRouter } from './api-key';
import { backupsRouter } from './backups';
import { brandingRouter } from './branding';
import { campaignRouter } from './campaign';
import { churnModelRouter } from './churn-model';
import { contactRouter } from './contact';
import { contactListRouter } from './contact-list';
import { copilotRouter } from './copilot';
import { credentialsRouter } from './credentials';
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
  me: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.session.activeOrganizationId ?? null;
    // The member role rides along so the client can hide what the server
    // would refuse anyway (the server check stays authoritative).
    const member = organizationId
      ? await authDb.member.findUnique({
          where: {
            organizationId_userId: { organizationId, userId: ctx.session.user.id },
          },
          select: { role: true },
        })
      : null;
    return {
      user: ctx.session.user,
      activeOrganizationId: organizationId,
      memberRole: member?.role ?? null,
    };
  }),
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
  churnModel: churnModelRouter,
  scheduling: schedulingRouter,
  crm: crmRouter,
  credentials: credentialsRouter,
  sso: ssoRouter,
  apiKey: apiKeyRouter,
  backups: backupsRouter,
  webhook: webhookRouter,
  branding: brandingRouter,
  integrations: integrationsRouter,
  support: supportRouter,
  deliverability: deliverabilityRouter,
  widget: widgetRouter,
  inAppMessage: inAppMessageRouter,
});

export type AppRouter = typeof appRouter;
