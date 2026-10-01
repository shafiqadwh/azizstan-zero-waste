import { roundsIcs } from '@/lib/calendar';
import { toAppError } from '@/server/errors';
import { assertPublicRate } from '@/server/http-guards';
import { publicSummary } from '@/server/public-cache';

export const dynamic = 'force-dynamic';

/** GET /calendar.ics — the active term's rounds for phone calendars (FR-W6, T31); public, 60/min/IP. */
export async function GET(request: Request) {
  try {
    assertPublicRate(request, new Date());
    const summary = await publicSummary();
    if (!summary.term) return new Response('ยังไม่มีภาคเรียนที่ใช้งาน', { status: 404 });
    const base = process.env.APP_URL ?? new URL(request.url).origin;
    const body = roundsIcs(summary.term, summary.rounds, { url: `${base}/calendar`, now: new Date() });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="zerowaste-${summary.term.academicYear}-${summary.term.termNo}.ics"`,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
