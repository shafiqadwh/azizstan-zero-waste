import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, validation } from '@/server/errors';
import { toResponse } from '@/server/result';
import { subscribePush, unsubscribePush } from '@/server/services/push.service';

export const dynamic = 'force-dynamic';

async function body(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw validation('endpoint', 'ข้อมูลไม่ถูกต้อง');
  }
}

/** POST /api/v1/push/subscription — `PushSubscription.toJSON()` of this browser for the signed-in user. */
export async function POST(request: Request) {
  return toResponse(
    async () => {
      const user = await getCurrentUser();
      if (!user) throw new AppError('UNAUTHENTICATED');
      const sub = await body(request);
      await subscribePush(
        getDb(),
        user,
        { endpoint: String(sub.endpoint ?? ''), keys: (sub.keys ?? {}) as { p256dh: string; auth: string } },
        request.headers.get('user-agent'),
        new Date(),
      );
      return { ok: true };
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** DELETE /api/v1/push/subscription — `{ endpoint }`: this browser stops receiving pushes. */
export async function DELETE(request: Request) {
  return toResponse(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AppError('UNAUTHENTICATED');
    await unsubscribePush(getDb(), user, String((await body(request)).endpoint ?? ''));
    return { ok: true };
  });
}
