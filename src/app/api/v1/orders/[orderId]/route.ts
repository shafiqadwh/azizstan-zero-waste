import { getDb } from '@/server/db';
import { toAppError } from '@/server/errors';
import { assertPublicRate } from '@/server/http-guards';
import { readOrderFile } from '@/server/services/content.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/orders/{id} — a published appointment order (public PDF). */
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  try {
    assertPublicRate(request, new Date());
    const { data } = await readOrderFile(getDb(), orderId);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="order-${orderId}.pdf"`,
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
