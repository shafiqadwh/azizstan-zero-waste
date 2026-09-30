'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import { createUser, resetUserPassword, setUserActive, setUserRole } from '@/server/services/user.service';

const PATH = '/admin/settings/users';

export type CreateUserState = (Result<{ username: string; tempPassword: string | null }> & { seq: number }) | null;
export type RowActionState = (Result<{ tempPassword?: string }> & { seq: number }) | null;

export async function createUserAction(prev: CreateUserState, form: FormData): Promise<CreateUserState> {
  const username = String(form.get('username') ?? '').trim();
  const result = await toResult(async () => {
    const user = await requireUser();
    const res = await createUser(
      getDb(),
      user,
      {
        username,
        displayName: String(form.get('displayName') ?? ''),
        role: String(form.get('role') ?? '') as never,
        authSource: String(form.get('authSource') ?? 'local') as never,
      },
      await clientMeta(),
      new Date(),
    );
    revalidatePath(PATH);
    return { username, tempPassword: res.tempPassword };
  });
  return { ...result, seq: (prev?.seq ?? 0) + 1 };
}

export async function userRowAction(prev: RowActionState, form: FormData): Promise<RowActionState> {
  const result = await toResult(async () => {
    const user = await requireUser();
    const userId = String(form.get('userId') ?? '');
    const intent = String(form.get('intent') ?? '');
    const meta = await clientMeta();
    const now = new Date();
    let out: { tempPassword?: string } = {};
    if (intent === 'role')
      await setUserRole(getDb(), user, { userId, role: String(form.get('role') ?? '') as never }, meta, now);
    else if (intent === 'activate' || intent === 'deactivate')
      await setUserActive(getDb(), user, { userId, active: intent === 'activate' }, meta, now);
    else if (intent === 'reset') out = await resetUserPassword(getDb(), user, { userId }, meta, now);
    revalidatePath(PATH);
    return out;
  });
  return { ...result, seq: (prev?.seq ?? 0) + 1 };
}
