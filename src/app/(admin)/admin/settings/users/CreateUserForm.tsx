'use client';

import { useActionState } from 'react';
import { Field, FormError, SubmitButton } from '@/components/app/form';
import { createUserAction, type CreateUserState } from './actions';
import { ROLE_LABEL } from './labels';
import { TempPasswordNotice } from './TempPasswordNotice';

const selectClass =
  'h-12 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand';

export function CreateUserForm() {
  const [state, action] = useActionState<CreateUserState, FormData>(createUserAction, null);
  const error = state && !state.ok ? state.error : undefined;
  const fieldError = (f: string) => (error?.field === f ? error.message : undefined);
  return (
    <section aria-labelledby="create-user" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="create-user" className="mb-4 text-[17px] font-bold">
        เพิ่มผู้ใช้
      </h2>
      {state?.ok ? (
        <div className="mb-4">
          <TempPasswordNotice
            key={state.seq}
            title={`เพิ่ม ${state.data.username} แล้ว`}
            tempPassword={state.data.tempPassword}
          />
        </div>
      ) : null}
      <form action={action} key={state?.ok ? state.seq : 'form'} className="grid gap-4 md:grid-cols-2">
        <Field
          label="ชื่อผู้ใช้"
          name="username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          error={fieldError('username')}
        />
        <Field label="ชื่อที่แสดง" name="displayName" autoComplete="off" required error={fieldError('displayName')} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="new-role" className="text-[14px] font-semibold">
            สิทธิ์
          </label>
          <select id="new-role" name="role" defaultValue="teacher" className={selectClass}>
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="new-source" className="text-[14px] font-semibold">
            ประเภทบัญชี
          </label>
          <select id="new-source" name="authSource" defaultValue="local" className={selectClass}>
            <option value="local">บัญชีในระบบ (ตั้งรหัสผ่านชั่วคราวให้)</option>
            <option value="school">บัญชีโรงเรียน (ใช้รหัสผ่านของระบบโรงเรียน)</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <FormError
            message={error && !['username', 'displayName'].includes(error.field ?? '') ? error.message : undefined}
          />
        </div>
        <div className="md:col-span-2 md:max-w-[280px]">
          <SubmitButton pendingLabel="กำลังเพิ่ม…">เพิ่มผู้ใช้</SubmitButton>
        </div>
      </form>
    </section>
  );
}
