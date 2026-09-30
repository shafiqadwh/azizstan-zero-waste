'use client';

import { useActionState, useState } from 'react';
import type { Role } from '@/server/policies';
import { userRowAction, type RowActionState } from './actions';
import { ROLE_LABEL } from './labels';
import { TempPasswordNotice } from './TempPasswordNotice';

const btn =
  'h-11 rounded-md border border-line-strong px-3 text-[14px] font-medium text-ink hover:bg-surface-muted disabled:opacity-60';

export function UserRowActions({
  userId,
  username,
  role,
  isActive,
  canResetPassword,
}: {
  userId: string;
  username: string;
  role: Role;
  isActive: boolean;
  canResetPassword: boolean;
}) {
  const [state, action, pending] = useActionState<RowActionState, FormData>(userRowAction, null);
  const [confirm, setConfirm] = useState<null | 'deactivate' | 'reset'>(null);
  const error = state && !state.ok ? state.error : undefined;

  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="userId" value={userId} />
        <label className="sr-only" htmlFor={`role-${userId}`}>
          สิทธิ์ของ {username}
        </label>
        <select
          id={`role-${userId}`}
          name="role"
          defaultValue={role}
          className="h-11 rounded-md border border-line-strong bg-surface px-2 text-[15px]"
        >
          {Object.entries(ROLE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" name="intent" value="role" disabled={pending} className={btn}>
          บันทึกสิทธิ์
        </button>

        {isActive ? (
          confirm === 'deactivate' ? (
            <button
              type="submit"
              name="intent"
              value="deactivate"
              disabled={pending}
              className={`${btn} border-danger text-danger-ink`}
            >
              ยืนยันปิดใช้งาน
            </button>
          ) : (
            <button type="button" onClick={() => setConfirm('deactivate')} className={btn}>
              ปิดใช้งาน
            </button>
          )
        ) : (
          <button type="submit" name="intent" value="activate" disabled={pending} className={btn}>
            เปิดใช้งาน
          </button>
        )}

        {canResetPassword ? (
          confirm === 'reset' ? (
            <button
              type="submit"
              name="intent"
              value="reset"
              disabled={pending}
              className={`${btn} border-danger text-danger-ink`}
            >
              ยืนยันรีเซ็ตรหัสผ่าน
            </button>
          ) : (
            <button type="button" onClick={() => setConfirm('reset')} className={btn}>
              รีเซ็ตรหัสผ่าน
            </button>
          )
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-ink">
          {error.message}
        </p>
      ) : null}
      {state?.ok && state.data.tempPassword ? (
        <TempPasswordNotice
          key={state.seq}
          title={`รีเซ็ตรหัสผ่านของ ${username} แล้ว`}
          tempPassword={state.data.tempPassword}
        />
      ) : null}
    </div>
  );
}
