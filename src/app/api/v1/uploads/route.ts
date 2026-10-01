import { clientMeta, getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, validation } from '@/server/errors';
import { IMAGE_MSG, MAX_UPLOAD_BYTES } from '@/server/evidence/image';
import { toResponse } from '@/server/result';
import { uploadEvidence } from '@/server/services/evidence.service';

export const dynamic = 'force-dynamic';

/** Room for the multipart envelope around a 15 MB photo. */
const ENVELOPE_BYTES = 64 * 1024;

/**
 * POST /api/v1/uploads — multipart `file`, `kind` (site | signature), `targetRef` (class:<id> | area:<id>).
 * Returns `{ evidenceId, url, capturedAt }` (05-api §3). Committee duty on the target; 30/min/user; ≤ 15 MB.
 */
export async function POST(request: Request) {
  return toResponse(
    async () => {
      const user = await getCurrentUser();
      if (!user) throw new AppError('UNAUTHENTICATED');
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > MAX_UPLOAD_BYTES + ENVELOPE_BYTES) throw validation('file', IMAGE_MSG.tooBig);
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw validation('file', 'กรุณาแนบรูปภาพ');
      }
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) throw validation('file', 'กรุณาแนบรูปภาพ');
      if (file.size > MAX_UPLOAD_BYTES) throw validation('file', IMAGE_MSG.tooBig);
      return uploadEvidence(
        getDb(),
        user,
        {
          kind: String(form.get('kind') ?? '') as 'site',
          targetRef: String(form.get('targetRef') ?? ''),
          data: new Uint8Array(await file.arrayBuffer()),
        },
        await clientMeta(),
        new Date(),
      );
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
