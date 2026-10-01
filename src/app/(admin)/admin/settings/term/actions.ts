'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult } from '@/server/result';
import { activateTerm, closeTerm, createTerm } from '@/server/services/term.service';
import type { MessageState } from '@/components/app/settings';

const done = async (prev: MessageState | null, fn: () => Promise<string>): Promise<MessageState> => {
  const r = await toResult(async () => {
    const message = await fn();
    revalidatePath('/admin/settings', 'layout');
    return { message };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
};

export async function createTermAction(prev: MessageState | null, form: FormData) {
  return done(prev, async () => {
    const academicYear = Number(form.get('academicYear'));
    const termNo = Number(form.get('termNo'));
    const copyFrom = String(form.get('copyFromTermId') ?? '');
    await createTerm(
      getDb(),
      await requireUser(),
      {
        academicYear,
        termNo,
        copyFromTermId: copyFrom || null,
        copyZones: form.get('copyZones') === 'on',
        copyDuties: form.get('copyDuties') === 'on',
      },
      await clientMeta(),
      new Date(),
    );
    return `สร้างภาคเรียนที่ ${termNo}/${academicYear} แล้ว (ร่าง)`;
  });
}

export async function activateTermAction(prev: MessageState | null, form: FormData) {
  return done(prev, async () => {
    await activateTerm(
      getDb(),
      await requireUser(),
      { termId: String(form.get('termId')) },
      await clientMeta(),
      new Date(),
    );
    return 'เปิดใช้ภาคเรียนแล้ว ภาคเรียนเดิมถูกปิด';
  });
}

export async function closeTermAction(prev: MessageState | null, form: FormData) {
  return done(prev, async () => {
    await closeTerm(
      getDb(),
      await requireUser(),
      { termId: String(form.get('termId')) },
      await clientMeta(),
      new Date(),
    );
    return 'ปิดภาคเรียนแล้ว ข้อมูลจะเก็บไว้ 1 ปีแล้วลบตามกำหนด';
  });
}
