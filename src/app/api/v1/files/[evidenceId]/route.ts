import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toAppError } from '@/server/errors';
import { readEvidenceFile } from '@/server/services/evidence.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/files/{evidenceId}?w=320 — the stamped WebP (or a 320/640 px copy), permission-checked. */
export async function GET(request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const { evidenceId } = await params;
  const w = Number(new URL(request.url).searchParams.get('w')) || null;
  try {
    const file = await readEvidenceFile(getDb(), await getCurrentUser(), evidenceId, w, new Date());
    const etag = `"${file.etag}"`;
    const headers = {
      'Content-Type': 'image/webp',
      // private: never cached by a shared proxy; the content behind an id never changes
      'Cache-Control': 'private, max-age=86400, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(file.data), { headers });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
