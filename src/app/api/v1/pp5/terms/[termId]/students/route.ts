import { getDb } from '@/server/db';
import { notFound } from '@/server/errors';
import { pp5Route } from '@/server/pp5-route';
import { getPp5Students } from '@/server/services/pp5.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/pp5/terms/{termId}/students — per student code, no names; 404 NOT_AVAILABLE without rosters. */
export async function GET(request: Request, { params }: { params: Promise<{ termId: string }> }) {
  const { termId } = await params;
  return pp5Route(request, async () => {
    if (!/^[0-9a-f-]{36}$/i.test(termId)) throw notFound();
    return getPp5Students(getDb(), termId, new Date());
  });
}
