import { getDb } from '@/server/db';
import { notFound } from '@/server/errors';
import { pp5Route } from '@/server/pp5-route';
import { getPp5Students, pp5StudentsCsv } from '@/server/services/pp5.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/pp5/terms/{termId}/students — per student code, no names; 404 NOT_AVAILABLE without rosters. CSV, or JSON with `?format=json`. */
export async function GET(request: Request, { params }: { params: Promise<{ termId: string }> }) {
  const { termId } = await params;
  return pp5Route(
    request,
    async () => {
      if (!/^[0-9a-f-]{36}$/i.test(termId)) throw notFound();
      return getPp5Students(getDb(), termId, new Date());
    },
    { rows: pp5StudentsCsv, filename: (d) => `pp5-students-${d.academicYear}-${d.termNo}.csv` },
  );
}
