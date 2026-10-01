'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import {
  deleteEvaluation,
  resubmitEvaluation,
  submitEvaluation,
  updateEvaluation,
  type submitInput,
  type updateInput,
} from '@/server/services/evaluation.service';
import type { z } from 'zod';

const refresh = (id?: string) => {
  revalidatePath('/tasks');
  if (id) revalidatePath(`/evaluate/${id}`);
};

export async function submitEvaluationAction(input: z.input<typeof submitInput>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const e = await submitEvaluation(getDb(), await requireUser(), input, await clientMeta(), new Date());
    refresh(e.id);
    return { id: e.id };
  });
}

export async function updateEvaluationAction(
  input: z.input<typeof updateInput>,
  mode: 'update' | 'resubmit',
): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const fn = mode === 'resubmit' ? resubmitEvaluation : updateEvaluation;
    const e = await fn(getDb(), await requireUser(), input, await clientMeta(), new Date());
    refresh(e.id);
    return { id: e.id };
  });
}

export async function deleteEvaluationAction(id: string, expectedVersion: number): Promise<Result<null>> {
  return toResult(async () => {
    await deleteEvaluation(getDb(), await requireUser(), { id, expectedVersion }, await clientMeta(), new Date());
    refresh(id);
    return null;
  });
}
