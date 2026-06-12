import { authDb } from '@/lib/auth';

/**
 * Public image serving for email assets. No auth by design: email
 * clients fetch images anonymously, so the unguessable asset id is the
 * capability — the same posture as hosted forms (/f) and landing pages
 * (/p). Bytes are immutable once uploaded, so caches may hold them
 * forever.
 */
export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  // The admin connection: RLS-exempt, matching the other public surfaces.
  const asset = await authDb.emailAsset.findUnique({
    where: { id: assetId },
    select: { bytes: true, contentType: true },
  });
  if (!asset) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
