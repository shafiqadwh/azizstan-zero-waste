import { getDb } from '@/server/db';
import { verifyPdfToken } from '@/server/pdf/token';
import { evaluationPdfHtml } from '@/server/services/pdf.service';

export const dynamic = 'force-dynamic';

/**
 * GET /internal/pdf/evaluation/{id}?t={token} — the exact HTML the worker prints (09-pdf §1), for checking the
 * layout. Needs a valid HMAC token (INTERNAL_PDF_SECRET); anything else is a plain 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get('t');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyPdfToken(process.env.INTERNAL_PDF_SECRET, id, token, new Date())) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const html = await evaluationPdfHtml(getDb(), id, new Date());
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
