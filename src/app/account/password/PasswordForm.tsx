'use client';

import { useActionState } from 'react';
import { changePasswordAction, type FormState } from '@/app/actions/auth';
import { FormError, PasswordField, SubmitButton } from '@/components/app/form';

export function PasswordForm({ redirectTo }: { redirectTo: string }) {
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, null);
  const error = state && !state.ok ? state.error : undefined;
  const fieldError = (f: string) => (error?.field === f ? error.message : undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="redirect" value={redirectTo} />
      <PasswordField
        label="รหัสผ่านปัจจุบัน"
        name="current"
        autoComplete="current-password"
        required
        error={fieldError('current')}
      />
      <PasswordField
        label="รหัสผ่านใหม่"
        name="next"
        autoComplete="new-password"
        required
        minLength={8}
        error={fieldError('next')}
      />
      <PasswordField
        label="ยืนยันรหัสผ่านใหม่"
        name="confirm"
        autoComplete="new-password"
        required
        error={fieldError('confirm')}
      />
      <FormError
        message={error && !['current', 'next', 'confirm'].includes(error.field ?? '') ? error.message : undefined}
      />
      <SubmitButton pendingLabel="กำลังบันทึก…">บันทึกรหัสผ่านใหม่</SubmitButton>
    </form>
  );
}
