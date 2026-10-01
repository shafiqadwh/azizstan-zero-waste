import { getDb } from '@/server/db';
import { notFound } from '@/server/errors';
import { pp5Route } from '@/server/pp5-route';
import { getPp5Classes, pp5ClassesCsv } from '@/server/services/pp5.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/pp5/terms/{termId}/classes — per class, finalized rounds only (05-api §3.3); CSV, or JSON with `?format=json`. */
export async function GET(request: Request, { params }: { params: Promise<{ termId: string }> }) {
  const { termId } = await params;
  return pp5Route(
    request,
    async () => {
      if (!/^[0-9a-f-]{36}$/i.test(termId)) throw notFound();
      return getPp5Classes(getDb(), termId, new Date());
    },
    { rows: pp5ClassesCsv, filename: (d) => `pp5-classes-${d.academicYear}-${d.termNo}.csv` },
  );
}
