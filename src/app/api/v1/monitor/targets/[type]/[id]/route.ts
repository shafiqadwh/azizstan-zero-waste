import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { notFound } from '@/server/errors';
import { toResponse } from '@/server/result';
import { getTargetDetail } from '@/server/services/monitor.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/monitor/targets/{class|area}/{id}?round= — the popover; 403 outside the caller's scope. */
export async function GET(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const round = new URL(request.url).searchParams.get('round') ?? undefined;
  return toResponse(async () => {
    if ((type !== 'class' && type !== 'area') || !/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    return getTargetDetail(getDb(), await requireUser(), { type, id, roundId: round }, new Date());
  });
}
