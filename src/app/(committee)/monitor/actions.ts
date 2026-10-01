'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import { retryPdf } from '@/server/services/monitor.service';

/** §6.17 "สร้างใหม่" on a failed PDF (admin). */
export async function retryPdfAction(evaluationId: string): Promise<Result<null>> {
  return toResult(async () => {
    await retryPdf(getDb(), await requireUser(), evaluationId, await clientMeta(), new Date());
    revalidatePath('/monitor');
    return null;
  });
}
