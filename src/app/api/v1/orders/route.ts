import { clientMeta, getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, validation } from '@/server/errors';
import { assertSameOrigin } from '@/server/http-guards';
import { refreshPublic } from '@/server/public-cache';
import { toResponse } from '@/server/result';
import { CONTENT_MSG, ORDER_MAX_BYTES, uploadOrder } from '@/server/services/content.service';

export const dynamic = 'force-dynamic';

/** POST /api/v1/orders — multipart `title`, `file` (PDF ≤ 10 MB); `content.manage`. */
export async function POST(request: Request) {
  return toResponse(
    async () => {
      const user = await getCurrentUser();
      if (!user) throw new AppError('UNAUTHENTICATED');
      assertSameOrigin(request);
      if (Number(request.headers.get('content-length') ?? 0) > ORDER_MAX_BYTES + 64 * 1024)
        throw validation('file', CONTENT_MSG.tooLarge);
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw validation('file', CONTENT_MSG.notPdf);
      }
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) throw validation('file', CONTENT_MSG.notPdf);
      const out = await uploadOrder(
        getDb(),
        user,
        { title: String(form.get('title') ?? ''), file: new Uint8Array(await file.arrayBuffer()) },
        await clientMeta(),
        new Date(),
      );
      refreshPublic();
      return out;
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
