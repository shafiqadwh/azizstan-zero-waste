'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { validation } from '@/server/errors';
import { toResult, type Result } from '@/server/result';
import { importDuties, parseDutiesWorkbook, type DutyImportReport } from '@/server/services/duties-import.service';
import { assignDuty, removeDuty } from '@/server/services/duty.service';

const PATH = '/admin/settings/committee';
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
/** datetime-local values are Bangkok wall-clock times. */
const bangkok = (v: string) => (v ? new Date(`${v}:00+07:00`) : null);

const done = async (prev: MessageState | null, fn: () => Promise<string>): Promise<MessageState> => {
  const r = await toResult(async () => {
    const message = await fn();
    revalidatePath(PATH);
    return { message };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
};

export async function assignDutyAction(prev: MessageState | null, form: FormData) {
  return done(prev, async () => {
    const duty = str(form, 'duty') === 'approver' ? 'approver' : 'committee';
    // target = "class:<id>" | "area:<id>" | "" (approver of every target)
    const [targetType, targetId] = str(form, 'target').split(':');
    const isFreelance = duty === 'committee' && form.get('isFreelance') === 'on';
    const out = await assignDuty(
      getDb(),
      await requireUser(),
      {
        termId: str(form, 'termId'),
        userId: str(form, 'userId'),
        duty,
        targetType: targetType === 'class' || targetType === 'area' ? targetType : null,
        targetId: targetId || null,
        isFreelance,
        validUntil: isFreelance ? bangkok(str(form, 'validUntil')) : null,
      },
      await clientMeta(),
      new Date(),
    );
    return out.enabledUser ? 'มอบหมายแล้ว และเปิดใช้บัญชีครูคนนี้' : 'มอบหมายแล้ว';
  });
}

export async function removeDutyAction(prev: MessageState | null, form: FormData) {
  return done(prev, async () => {
    await removeDuty(getDb(), await requireUser(), { dutyId: str(form, 'dutyId') }, await clientMeta(), new Date());
    return 'นำออกแล้ว';
  });
}

export async function importDutiesAction(form: FormData): Promise<Result<DutyImportReport>> {
  return toResult(async () => {
    const user = await requireUser();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw validation('file', 'กรุณาเลือกไฟล์ duties.xlsx');
    const rows = await parseDutiesWorkbook(await file.arrayBuffer());
    const report = await importDuties(
      getDb(),
      user,
      str(form, 'termId'),
      rows,
      { commit: form.get('commit') === '1' },
      await clientMeta(),
      new Date(),
    );
    if (report.committed) revalidatePath(PATH);
    return report;
  });
}
