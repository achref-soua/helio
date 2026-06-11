import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth, authDb } from '@/lib/auth';
import { appDb } from '@/lib/db';
import { env } from '@/lib/env';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/public-rate-limit';

/**
 * Stream a backup file to an authenticated OWNER. The filename comes
 * exclusively from the database row (never the URL), so there is no path
 * to traverse; the folder is the sidecar's volume, mounted read-only.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!env.BACKUPS_PANEL_ENABLED) {
    return NextResponse.json({ error: 'backups_disabled' }, { status: 404 });
  }
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
  if (member?.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const decision = await checkPublicRateLimit('backupDownload', session.user.id);
  if (!decision.allowed) return rateLimitedResponse(decision);

  const { id } = await context.params;
  const run = await appDb.backupRun.findUnique({ where: { id } });
  if (!run || run.status !== 'OK') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const filePath = path.join(env.HELIO_BACKUPS_PATH, run.filename);
  if (!existsSync(filePath)) {
    return NextResponse.json(
      { error: 'file_unavailable', hint: 'the backups volume is not mounted into the dashboard' },
      { status: 404 },
    );
  }
  const size = statSync(filePath).size;
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${run.filename}"`,
      'cache-control': 'no-store',
    },
  });
}
