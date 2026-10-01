'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult } from '@/server/result';
import { editRoundClassArea } from '@/server/services/round.service';

export async function editRoundClassAreaAction(prev: MessageState | null, form: FormData): Promise<MessageState> {
  const roundId = String(form.get('roundId') ?? '');
  const r = await toResult(async () => {
    await editRoundClassArea(
      getDb(),
      await requireUser(),
      { roundId, classId: String(form.get('classId') ?? ''), areaId: String(form.get('areaId') ?? '') },
      await clientMeta(),
      new Date(),
    );
    revalidatePath(`/admin/settings/rounds/${roundId}`);
    return { message: 'บันทึกแล้ว' };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
}
