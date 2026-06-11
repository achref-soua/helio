import { pushSalesforceLead, salesforceLeadFromContact } from '@helio/core';
import type { TenantClient } from '@helio/db';
import { trace } from '@opentelemetry/api';

import { openRowSecret } from './vault';

interface PushContext {
  tenantDb: TenantClient;
  organizationId: string;
}

interface ContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  attributes?: unknown;
}

/**
 * Push a new contact to Salesforce as a Lead when the org has an enabled
 * connection. Best-effort by design: no connection is a no-op, and a Salesforce
 * error is recorded on the active trace span but never fails the originating
 * mutation.
 */
export async function pushContactToSalesforce(
  ctx: PushContext,
  contact: ContactInput,
): Promise<void> {
  try {
    const integration = await ctx.tenantDb.integration.findFirst({
      where: { provider: 'SALESFORCE', enabled: true },
      select: { id: true, secret: true, config: true },
    });
    const instanceUrl = (integration?.config as { instanceUrl?: string } | null)?.instanceUrl;
    if (!integration?.secret || !instanceUrl) return;
    const accessToken = await openRowSecret(
      ctx.organizationId,
      integration.id,
      'secret',
      integration.secret,
    );
    await pushSalesforceLead(fetch, instanceUrl, accessToken, salesforceLeadFromContact(contact));
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(error instanceof Error ? error : new Error(String(error)));
  }
}
