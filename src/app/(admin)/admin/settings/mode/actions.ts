'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult } from '@/server/result';
import { updateTermConfig } from '@/server/services/term.service';

const n = (f: FormData, k: string) => Number(f.get(k));
const s = (f: FormData, k: string) => String(f.get(k) ?? '');

export async function saveModeAction(prev: MessageState | null, form: FormData): Promise<MessageState> {
  const r = await toResult(async () => {
    await updateTermConfig(
      getDb(),
      await requireUser(),
      {
        termId: s(form, 'termId'),
        areaType: s(form, 'areaType') as never,
        roomMode: s(form, 'roomMode') as never,
        areaMode: s(form, 'areaMode') as never,
        scoreFormat: s(form, 'scoreFormat') as never,
        scoreStep: (s(form, 'scoreStep') || '0.500') as never,
        finalMax: s(form, 'finalMax'),
        photoMin: n(form, 'photoMin'),
        photoMax: n(form, 'photoMax'),
        commentMax: n(form, 'commentMax'),
        selfEditHours: n(form, 'selfEditHours'),
        lateEntryDefaultHours: n(form, 'lateEntryDefaultHours'),
      },
      await clientMeta(),
      new Date(),
    );
    revalidatePath('/admin/settings', 'layout');
    return { message: 'บันทึกการตั้งค่าแล้ว' };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
}
