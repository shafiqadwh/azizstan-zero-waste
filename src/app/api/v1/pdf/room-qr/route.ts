import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, toAppError } from '@/server/errors';
import { renderPdfOnDemand } from '@/server/pdf/on-demand';
import { roomQrSheet } from '@/server/services/room-qr.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/pdf/room-qr[?buildingId=|roomId=] — QR sheet of the rooms, A4 with 12 per page (T34); admins.
 * `&format=html` returns the printable page instead. QR codes point at APP_URL (the address phones can reach).
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AppError('UNAUTHENTICATED');
    const url = new URL(request.url);
    const sheet = await roomQrSheet(
      getDb(),
      user,
      {
        buildingId: url.searchParams.get('buildingId') || undefined,
        roomId: url.searchParams.get('roomId') || undefined,
      },
      { baseUrl: process.env.APP_URL ?? url.origin, now: new Date() },
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
