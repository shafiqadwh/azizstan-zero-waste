'use server';

import { redirect } from 'next/navigation';
import {
  clearSessionCookie,
  clientMeta,
  getCurrentUser,
  requireUser,
  setSessionCookie,
} from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import { changePassword, login, logout } from '@/server/services/auth.service';
import { safeNext } from '@/server/auth/redirects';

export type FormState = Result<{ redirectTo: string }> | null;
/** Login keeps the typed username so React's post-action form reset does not clear it. */
export type LoginState = (Result<{ redirectTo: string }> & { username?: string }) | null;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get('username') ?? '');
  const result = await toResult(async () => {
    const res = await login(
      getDb(),
      {
        username: String(form.get('username') ?? ''),
        password: String(form.get('password') ?? ''),
        next: String(form.get('next') ?? ''),
      },
      await clientMeta(),
      new Date(),
    );
    await setSessionCookie(res.token, res.expiresAt);
    return { redirectTo: res.redirectTo };
  });
  if (result.ok) redirect(result.data.redirectTo);
  return { ...result, username };
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await toResult(async () => {
    const user = await requireUser({ allowMustChange: true });
    await changePassword(
      getDb(),
      user,
      {
        current: String(form.get('current') ?? ''),
        next: String(form.get('next') ?? ''),
        confirm: String(form.get('confirm') ?? ''),
      },
      await clientMeta(),
      new Date(),
    );
    return {
      redirectTo: safeNext(String(form.get('redirect') ?? '')) ?? (user.role === 'teacher' ? '/tasks' : '/admin'),
    };
  });
  if (result.ok) redirect(result.data.redirectTo);
  return result;
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await logout(getDb(), user, await clientMeta(), new Date());
  await clearSessionCookie();
  redirect('/login');
}
