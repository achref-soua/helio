import { can, newId } from '@helio/core';
import { forTenant } from '@helio/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth, authDb } from '@/lib/auth';
import { appDb } from '@/lib/db';
import { env } from '@/lib/env';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/public-rate-limit';

/** Email images stay small: inbox clients time out on heavy assets. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Sniffed magic bytes — the client-sent content type is advisory only. */
const SIGNATURES: ReadonlyArray<{ contentType: string; matches: (b: Uint8Array) => boolean }> = [
  {
    contentType: 'image/png',
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { contentType: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    contentType: 'image/gif',
    matches: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    contentType: 'image/webp',
    matches: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/**
 * Image upload for the email builder. The bytes live in Postgres (the
 * core profile has no object store) and are served publicly by /a/[id]
 * with an absolute URL, because email clients fetch images anonymously.
 */
export async function POST(request: Request) {
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
  if (!can(member?.role ?? '', 'templates:write')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const decision = await checkPublicRateLimit('assetUpload', session.user.id);
  if (!decision.allowed) return rateLimitedResponse(decision);

  const form = await request.formData();
  const file = form.get('file');
  const workspaceId = String(form.get('workspaceId') ?? '');
  if (!(file instanceof File) || !workspaceId) {
    return NextResponse.json({ error: 'file and workspaceId are required' }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'the image is larger than 2 MiB — resize or compress it first' },
      { status: 413 },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
  if (!signature) {
    return NextResponse.json(
      { error: 'only PNG, JPEG, GIF, and WebP images are accepted' },
      { status: 422 },
    );
  }

  const tenantDb = forTenant(appDb, organizationId);
  const workspace = await tenantDb.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return NextResponse.json({ error: 'workspace not found' }, { status: 404 });

  const assetId = newId('ast');
  await tenantDb.emailAsset.create({
    data: {
      id: assetId,
      organizationId,
      workspaceId,
      filename: file.name.slice(0, 200),
      contentType: signature.contentType,
      sizeBytes: file.size,
      bytes,
    },
  });

  return NextResponse.json({ id: assetId, url: `${env.APP_URL}/a/${assetId}` }, { status: 201 });
}
