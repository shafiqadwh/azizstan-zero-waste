import { getDb } from '@/server/db';
import { pp5Route } from '@/server/pp5-route';
import { listPp5Terms, pp5TermsCsv } from '@/server/services/pp5.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/pp5/terms (05-api §3.3) — CSV, or JSON with `?format=json`. */
export async function GET(request: Request) {
  return pp5Route(request, () => listPp5Terms(getDb()), { rows: pp5TermsCsv, filename: () => 'pp5-terms.csv' });
}
