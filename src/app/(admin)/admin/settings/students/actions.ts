'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult } from '@/server/result';
import { addClassAlias } from '@/server/services/place.service';
import { addSkipRule, removeSkipRule, requestStudentSync } from '@/server/services/student.service';

const PATH = '/admin/settings/students';
const wrap = async (prev: MessageState | null, fn: () => Promise<string>): Promise<MessageState> => {
  const r = await toResult(async () => {
    const message = await fn();
    revalidatePath(PATH);
    return { message };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
};

export async function requestSyncAction(prev: MessageState | null): Promise<MessageState> {
  return wrap(prev, async () => {
    await requestStudentSync(getDb(), await requireUser(), await clientMeta(), new Date());
    return 'ส่งคำสั่งแล้ว ระบบจะเริ่ม sync ภายใน 1 นาที';
  });
}

/** "จับคู่กับห้อง…": the unknown class string becomes an alias of the chosen class; the next sync resolves it. */
export async function mapClassAction(prev: MessageState | null, form: FormData): Promise<MessageState> {
  return wrap(prev, async () => {
    await addClassAlias(
      getDb(),
      await requireUser(),
      { classId: String(form.get('classId') ?? ''), alias: String(form.get('alias') ?? '') },
      await clientMeta(),
      new Date(),
    );
    return 'จับคู่แล้ว จะมีผลในการ sync ครั้งถัดไป';
  });
}

export async function addSkipRuleAction(prev: MessageState | null, form: FormData): Promise<MessageState> {
  return wrap(prev, async () => {
    await addSkipRule(
      getDb(),
      await requireUser(),
      { prefix: String(form.get('prefix') ?? ''), note: String(form.get('note') ?? '') || undefined },
      await clientMeta(),
      new Date(),
    );
    return 'เพิ่มแล้ว';
  });
}

export async function removeSkipRuleAction(prev: MessageState | null, form: FormData): Promise<MessageState> {
  return wrap(prev, async () => {
    await removeSkipRule(getDb(), await requireUser(), String(form.get('id') ?? ''), await clientMeta(), new Date());
    return 'ลบแล้ว';
  });
}
