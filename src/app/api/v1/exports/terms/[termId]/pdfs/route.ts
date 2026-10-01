import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, notFound, toAppError } from '@/server/errors';
import { termPdfArchive } from '@/server/services/retention.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/exports/terms/{termId}/pdfs — the archive ZIP of every PDF of the term (BR-D2, T28), streamed.
 * Staff only. The Excel half of the archive is GET /api/v1/exports/terms/{termId}.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ termId: string }> }) {
  const { termId } = await params;
  try {
    const user = await getCurrentUser();
    if (!user) throw new AppError('UNAUTHENTICATED');
    if (!/^[0-9a-f-]{36}$/i.test(termId)) throw notFound();
    const archive = await termPdfArchive(getDb(), user, termId);
    return new Response(archive.stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archive.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
