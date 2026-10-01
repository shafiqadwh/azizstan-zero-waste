import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResponse } from '@/server/result';
import { getBoard, parseBoardQuery } from '@/server/services/monitor.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/monitor/board?round=&status=&group=&area=&committee=&q=&mine= — scope per `monitor.read`. */
export async function GET(request: Request) {
  return toResponse(async () =>
    getBoard(getDb(), await requireUser(), parseBoardQuery(new URL(request.url).searchParams), new Date()),
  );
}
