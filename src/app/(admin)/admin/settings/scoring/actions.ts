'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { validation } from '@/server/errors';
import { toResult } from '@/server/result';
import { setRoundCount, updateRoundDates, updateScoring } from '@/server/services/term.service';

const finish = async (prev: MessageState | null, fn: () => Promise<string>): Promise<MessageState> => {
  const r = await toResult(async () => {
    const message = await fn();
    revalidatePath('/admin/settings', 'layout');
    return { message };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
};

/** The scoring card posts one JSON payload (components table + per-round grid). */
export async function saveScoringAction(prev: MessageState | null, form: FormData) {
  return finish(prev, async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get('payload') ?? ''));
    } catch {
      throw validation('payload', 'ข้อมูลไม่ครบ กรุณาโหลดหน้าใหม่');
    }
    await updateScoring(getDb(), await requireUser(), payload as never, await clientMeta(), new Date());
    return 'บันทึกส่วนคะแนนแล้ว';
  });
}

export async function setRoundCountAction(prev: MessageState | null, form: FormData) {
  return finish(prev, async () => {
    const count = Number(form.get('count'));
    await setRoundCount(
      getDb(),
      await requireUser(),
      { termId: String(form.get('termId')), count },
      await clientMeta(),
      new Date(),
    );
    return `ตั้งเป็น ${count} รอบแล้ว`;
  });
}

/** datetime-local values are Bangkok wall-clock times. */
const bangkok = (v: FormDataEntryValue | null) => new Date(`${String(v ?? '')}:00+07:00`);

export async function saveRoundDatesAction(prev: MessageState | null, form: FormData) {
  return finish(prev, async () => {
    await updateRoundDates(
      getDb(),
      await requireUser(),
      {
        roundId: String(form.get('roundId')),
        opensAt: bangkok(form.get('opensAt')),
        closesAt: bangkok(form.get('closesAt')),
      },
      await clientMeta(),
      new Date(),
    );
    return 'บันทึกวันที่แล้ว';
  });
}
