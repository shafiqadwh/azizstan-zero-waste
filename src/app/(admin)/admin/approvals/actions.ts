'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import { approveRequest, rejectRequest } from '@/server/services/request.service';

const refresh = (evaluationId: string | null) => {
  revalidatePath('/admin/approvals');
  revalidatePath('/tasks');
  if (evaluationId) revalidatePath(`/evaluate/${evaluationId}`);
};

export async function approveRequestAction(
  id: string,
  evaluationId: string | null,
  opts: { note?: string; grantHours?: number },
): Promise<Result<null>> {
  return toResult(async () => {
    await approveRequest(getDb(), await requireUser(), { id, ...opts }, await clientMeta(), new Date());
    refresh(evaluationId);
    return null;
  });
}

export async function rejectRequestAction(
  id: string,
  evaluationId: string | null,
  note?: string,
): Promise<Result<null>> {
  return toResult(async () => {
    await rejectRequest(getDb(), await requireUser(), { id, note }, await clientMeta(), new Date());
    refresh(evaluationId);
    return null;
  });
}
