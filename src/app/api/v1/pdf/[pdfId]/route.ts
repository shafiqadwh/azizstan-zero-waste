import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toAppError } from '@/server/errors';
import { readPdf } from '@/server/services/pdf.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/pdf/{pdfId} — streams one PDF version (05-api §3); staff, owner or committee of the target. */
export async function GET(_request: Request, { params }: { params: Promise<{ pdfId: string }> }) {
  const { pdfId } = await params;
  try {
    const { data, fileName } = await readPdf(getDb(), await getCurrentUser(), pdfId, new Date());
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
