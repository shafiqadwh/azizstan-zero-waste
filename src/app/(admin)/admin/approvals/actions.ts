'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import { approveEvaluation, returnEvaluation } from '@/server/services/evaluation.service';
import { approveRequest, rejectRequest } from '@/server/services/request.service';

const refresh = (evaluationId: string | null) => {
  revalidatePath('/admin/approvals');
  revalidatePath('/admin');
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

/** §6.11 "อนุมัติและออก PDF" (BR-E6): approve and queue the PDF. */
export async function approveEvaluationAction(id: string, expectedVersion: number): Promise<Result<null>> {
  return toResult(async () => {
    await approveEvaluation(getDb(), await requireUser(), { id, expectedVersion }, await clientMeta(), new Date());
    refresh(id);
    return null;
  });
}

/** §6.11 "ส่งกลับ" with a reason (BR-E7). */
export async function returnEvaluationAction(
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<Result<null>> {
  return toResult(async () => {
    await returnEvaluation(
      getDb(),
      await requireUser(),
      { id, expectedVersion, reason },
      await clientMeta(),
      new Date(),
    );
    refresh(id);
    return null;
  });
}
