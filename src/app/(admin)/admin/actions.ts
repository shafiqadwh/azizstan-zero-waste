'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult } from '@/server/result';
import { remindPendingCommittees } from '@/server/services/dashboard.service';

/** §6.10 "แจ้งเตือนกรรมการที่ค้าง". */
export async function remindCommitteesAction(prev: MessageState | null): Promise<MessageState> {
  const r = await toResult(async () => {
    const out = await remindPendingCommittees(getDb(), await requireUser(), await clientMeta(), new Date());
    revalidatePath('/admin');
    return { message: out.message };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
}
