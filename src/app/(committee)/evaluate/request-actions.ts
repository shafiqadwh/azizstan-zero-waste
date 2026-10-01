'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import { cancelRequest, createRequest, type createRequestInput } from '@/server/services/request.service';
import type { z } from 'zod';

export async function createRequestAction(input: z.input<typeof createRequestInput>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const out = await createRequest(getDb(), await requireUser(), input, await clientMeta(), new Date());
    revalidatePath('/tasks');
    if (input.evaluationId) revalidatePath(`/evaluate/${input.evaluationId}`);
    revalidatePath('/admin/approvals');
    return out;
  });
}

export async function cancelRequestAction(id: string, evaluationId: string | null): Promise<Result<null>> {
  return toResult(async () => {
    await cancelRequest(getDb(), await requireUser(), { id }, await clientMeta(), new Date());
    if (evaluationId) revalidatePath(`/evaluate/${evaluationId}`);
    revalidatePath('/admin/approvals');
    return null;
  });
}
