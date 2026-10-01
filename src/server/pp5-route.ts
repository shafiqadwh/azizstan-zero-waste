import { toCsv, type Cell } from '../lib/csv/write';
import { getDb } from './db';
import { toAppError } from './errors';
import { assertPublicRate, callerIp } from './http-guards';
import { authorizePp5 } from './services/pp5.service';

/**
 * Network + API key check, then the handler. The ปพ.5 program gets **CSV** (UTF-8 with BOM); `?format=json`
 * returns the same data as JSON (05-api §3.3). Errors stay JSON with their HTTP status (401/403/404).
 */
export async function pp5Route<T>(
  request: Request,
  fn: () => Promise<T>,
  csv: { rows: (data: T) => Cell[][]; filename: (data: T) => string },
): Promise<Response> {
  try {
    assertPublicRate(request, new Date());
    await authorizePp5(
      getDb(),
      { ip: callerIp(request), authorization: request.headers.get('authorization') },
      new Date(),
    );
    const data = await fn();
    if (new URL(request.url).searchParams.get('format') === 'json')
      return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
    return new Response(toCsv(csv.rows(data)), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csv.filename(data)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
