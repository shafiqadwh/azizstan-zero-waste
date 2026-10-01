import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, toAppError } from '@/server/errors';
import { renderPdfOnDemand } from '@/server/pdf/on-demand';
import { signatureSheetHtmlFor } from '@/server/services/signature-sheet.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/pdf/signature-sheet?classId=&roundId= — the blank signature sheet as a PDF (09-pdf §3, T30),
 * rendered on demand, not stored. `&format=html` returns the printable HTML instead (same page, for checking).
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AppError('UNAUTHENTICATED');
    const url = new URL(request.url);
    const sheet = await signatureSheetHtmlFor(
      getDb(),
      user,
      { classId: url.searchParams.get('classId') ?? '', roundId: url.searchParams.get('roundId') ?? '' },
      new Date(),
    );
    if (url.searchParams.get('format') === 'html')
      return new Response(sheet.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    const pdf = await renderPdfOnDemand(sheet.html);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${sheet.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
