import { forTenant } from '@helio/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth, authDb } from '@/lib/auth';
import { appDb } from '@/lib/db';
import { env } from '@/lib/env';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/public-rate-limit';

/**
 * Training-data CSV for offline churn-model building: the exact feature
 * columns the runtime will feed a custom model, plus the label. Emails
 * stay out of the file unless explicitly requested (`includeEmail=1`).
 */
export async function GET(request: Request) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const organizationId = session?.session.activeOrganizationId;
  if (!session || !organizationId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const member = await authDb.member.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.user.id } },
    select: { role: true },
  });
  if (member?.role !== 'owner' && member?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const decision = await checkPublicRateLimit('modelExport', session.user.id);
  if (!decision.allowed) return rateLimitedResponse(decision);

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const includeEmail = url.searchParams.get('includeEmail') === '1';
  const tenantDb = forTenant(appDb, organizationId);
  const workspace = await tenantDb.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return NextResponse.json({ error: 'workspace not found' }, { status: 404 });

  let response: Response;
  try {
    response = await fetch(`${env.INTELLIGENCE_URL}/v1/scoring/features-export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organization_id: organizationId,
        workspace_id: workspaceId,
        include_email: includeEmail,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return NextResponse.json(
      { error: 'the intelligence service is not running — start it and retry' },
      { status: 503 },
    );
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { detail?: string };
    return NextResponse.json(
      { error: detail.detail ?? 'the export failed' },
      { status: response.status === 503 ? 503 : 502 },
    );
  }
  return new Response(await response.text(), {
    headers: {
      'content-type': 'text/csv',
      'content-disposition': 'attachment; filename="churn-training-data.csv"',
      'cache-control': 'no-store',
    },
  });
}
