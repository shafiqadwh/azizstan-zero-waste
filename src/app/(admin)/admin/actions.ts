'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult } from '@/server/result';
import { confirmPassword } from '@/server/services/auth.service';
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

/** Step-up (12-security §2 item 7): re-enter the password to unlock permission changes for 10 minutes. */
export async function confirmPasswordAction(prev: MessageState | null, form: FormData): Promise<MessageState> {
  const r = await toResult(async () => {
    await confirmPassword(
      getDb(),
      await requireUser(),
      { password: String(form.get('password') ?? '') },
      await clientMeta(),
      new Date(),
    );
    revalidatePath('/admin/settings', 'layout');
    return { message: 'ยืนยันแล้ว ทำรายการได้ภายใน 10 นาที' };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
}
