import { CHURN_UPLOAD_EXTENSIONS, churnFeatureMappingSchema, newId } from '@helio/core';
import { forTenant, Prisma } from '@helio/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth, authDb } from '@/lib/auth';
import { appDb } from '@/lib/db';
import { env } from '@/lib/env';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/public-rate-limit';

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Churn-model artifact upload (ADR-0021): multipart lands here (tRPC is
 * JSON-only), gets the same gates as the intelligence service — pickle
 * refused by magic byte with the conversion recipe, 50 MiB cap — then the
 * row is created VALIDATING and the bytes are forwarded for the sandboxed
 * verdict. An unreachable intelligence service is a FAILED row with a
 * plain-words reason, never a 500.
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
  if (member?.role !== 'owner' && member?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const decision = await checkPublicRateLimit('modelUpload', session.user.id);
  if (!decision.allowed) return rateLimitedResponse(decision);

  const form = await request.formData();
  const file = form.get('file');
  const workspaceId = String(form.get('workspaceId') ?? '');
  const name = String(form.get('name') ?? '').trim();
  const format = String(form.get('format') ?? '');
  let mapping;
  try {
    mapping = churnFeatureMappingSchema.parse({
      inputs: JSON.parse(String(form.get('inputs') ?? '[]')),
    });
  } catch {
    return NextResponse.json({ error: 'invalid feature mapping' }, { status: 422 });
  }
  if (!(file instanceof File) || !workspaceId || !name || name.length > 120) {
    return NextResponse.json(
      { error: 'file, workspaceId, and name are required' },
      { status: 422 },
    );
  }
  if (!(format in CHURN_UPLOAD_EXTENSIONS)) {
    return NextResponse.json(
      { error: 'format must be ONNX or XGBOOST_JSON (register HTTP endpoints instead)' },
      { status: 422 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'the model file is larger than 50 MiB — export a smaller model' },
      { status: 413 },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x80) {
    return NextResponse.json(
      {
        error:
          'pickle files are not accepted (they can execute code on load) — export the model ' +
          'to ONNX instead: pip install skl2onnx, then to_onnx(model, X[:1])',
      },
      { status: 422 },
    );
  }

  const tenantDb = forTenant(appDb, organizationId);
  const workspace = await tenantDb.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return NextResponse.json({ error: 'workspace not found' }, { status: 404 });

  const modelId = newId('chm');
  try {
    await tenantDb.churnModel.create({
      data: {
        id: modelId,
        organizationId,
        workspaceId,
        name,
        format: format as 'ONNX' | 'XGBOOST_JSON',
        filename: file.name.slice(0, 200),
        sizeBytes: file.size,
        featureMapping: mapping as Prisma.InputJsonValue,
        status: 'VALIDATING',
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'a model with this name already exists in this workspace' },
        { status: 409 },
      );
    }
    throw error;
  }

  // Forward the bytes for storage + the sandboxed verdict.
  let verdict: { ok: boolean; error?: string | null; sha256?: string | null };
  try {
    const forwarded = new FormData();
    forwarded.set('file', new Blob([bytes]), file.name);
    forwarded.set('organization_id', organizationId);
    forwarded.set('model_id', modelId);
    forwarded.set('format', format);
    forwarded.set('n_inputs', String(mapping.inputs.length));
    const response = await fetch(`${env.INTELLIGENCE_URL}/v1/models/churn/upload`, {
      method: 'POST',
      body: forwarded,
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 422) {
      const detail = (await response.json().catch(() => ({}))) as { detail?: string };
      verdict = { ok: false, error: detail.detail ?? 'the model file was rejected' };
    } else if (!response.ok) {
      verdict = { ok: false, error: `the intelligence service answered HTTP ${response.status}` };
    } else {
      verdict = (await response.json()) as { ok: boolean; error?: string | null; sha256?: string };
    }
  } catch {
    verdict = {
      ok: false,
      error: 'the intelligence service is not running — start it, then use Re-validate',
    };
  }

  const row = await tenantDb.churnModel.update({
    where: { id: modelId },
    data: verdict.ok
      ? { status: 'DISABLED', lastError: null, validatedAt: new Date(), sha256: verdict.sha256 }
      : { status: 'FAILED', lastError: verdict.error ?? 'validation failed' },
  });
  await tenantDb.auditLog.create({
    data: {
      id: newId('audit'),
      organizationId,
      workspaceId,
      actorId: session.user.id,
      action: 'churn_model.uploaded',
      targetType: 'churn_model',
      targetId: modelId,
      metadata: { name, format },
    },
  });
  return NextResponse.json({ id: row.id, status: row.status, lastError: row.lastError });
}
