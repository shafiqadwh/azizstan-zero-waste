'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import { createApiKey, revokeApiKey } from '@/server/services/pp5.service';

export async function createKeyAction(name: string): Promise<Result<{ key: string }>> {
  return toResult(async () => {
    const { key } = await createApiKey(getDb(), await requireUser(), { name }, await clientMeta(), new Date());
    revalidatePath('/admin/settings/api');
    return { key };
  });
}

export async function revokeKeyAction(id: string): Promise<Result<null>> {
  return toResult(async () => {
    await revokeApiKey(getDb(), await requireUser(), id, await clientMeta(), new Date());
    revalidatePath('/admin/settings/api');
    return null;
  });
}
