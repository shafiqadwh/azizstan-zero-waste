'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from '@/app/actions/auth';
import { Field, FormError, PasswordField, SubmitButton } from '@/components/app/form';

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, null);
  const error = state && !state.ok ? state.error : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field
        label="ชื่อผู้ใช้"
        name="username"
        defaultValue={state?.username}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        error={error?.field === 'username' ? error.message : undefined}
      />
      <PasswordField
        label="รหัสผ่าน"
        name="password"
        autoComplete="current-password"
        required
        error={error?.field === 'password' ? error.message : undefined}
      />
      <FormError
        message={error && error.field !== 'username' && error.field !== 'password' ? error.message : undefined}
      />
      <SubmitButton pendingLabel="กำลังเข้าสู่ระบบ…">เข้าสู่ระบบ</SubmitButton>
      <p className="text-ink-muted text-[13px]">ใช้บัญชีเดียวกับระบบของโรงเรียน</p>
    </form>
  );
}
