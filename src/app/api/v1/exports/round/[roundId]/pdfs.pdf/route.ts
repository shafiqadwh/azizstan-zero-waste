import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, notFound, toAppError } from '@/server/errors';
import { mergeRoundPdfs } from '@/server/services/round-pdf.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/exports/round/{roundId}/pdfs.pdf — all current PDFs of the round as one file (FR-D5, T32). Staff. */
export async function GET(_request: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  try {
    const user = await getCurrentUser();
    if (!user) throw new AppError('UNAUTHENTICATED');
    if (!/^[0-9a-f-]{36}$/i.test(roundId)) throw notFound();
    const merged = await mergeRoundPdfs(getDb(), user, roundId);
    return new Response(new Uint8Array(merged.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${merged.filename}"`,
        'Cache-Control': 'no-store',
        'X-Documents': String(merged.documents),
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
