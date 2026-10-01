import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResponse } from '@/server/result';
import { getActivity } from '@/server/services/monitor.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/monitor/activity?round=&since= — the latest 50 events (11-jobs §2b), same scope as the board. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const since = p.get('since') ? new Date(p.get('since')!) : undefined;
  return toResponse(async () =>
    getActivity(
      getDb(),
      await requireUser(),
      { roundId: p.get('round') ?? undefined, since: since && !isNaN(since.getTime()) ? since : undefined },
      new Date(),
    ),
  );
}
