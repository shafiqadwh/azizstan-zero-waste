'use server';

import { revalidatePath } from 'next/cache';
import type { MessageState } from '@/components/app/settings';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { refreshPublic } from '@/server/public-cache';
import { toResult, type Result } from '@/server/result';
import { deleteGuidePage, deleteOrder, saveGuidePage } from '@/server/services/content.service';

const done = () => {
  revalidatePath('/admin/settings/content');
  refreshPublic();
};

export async function deleteOrderAction(id: string): Promise<Result<null>> {
  return toResult(async () => {
    await deleteOrder(getDb(), await requireUser(), id, await clientMeta(), new Date());
    done();
    return null;
  });
}

export async function saveGuideAction(prev: MessageState | null, form: FormData): Promise<MessageState> {
  const r = await toResult(async () => {
    const id = String(form.get('id') ?? '');
    await saveGuidePage(
      getDb(),
      await requireUser(),
      {
        id: id || undefined,
        slug: String(form.get('slug') ?? ''),
        title: String(form.get('title') ?? ''),
        bodyMd: String(form.get('bodyMd') ?? ''),
        audience: String(form.get('audience') ?? 'public') as 'public',
        sortOrder: Number(form.get('sortOrder') ?? 0),
      },
      await clientMeta(),
      new Date(),
    );
    done();
    return { message: 'บันทึกแล้ว' };
  });
  return { ...r, seq: (prev?.seq ?? 0) + 1 };
}

export async function deleteGuideAction(id: string): Promise<Result<null>> {
  return toResult(async () => {
    await deleteGuidePage(getDb(), await requireUser(), id, await clientMeta(), new Date());
    done();
    return null;
  });
}
