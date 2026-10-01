'use client';

import { ShieldCheck } from 'lucide-react';
import { useActionState } from 'react';
import { confirmPasswordAction } from '@/app/(admin)/admin/actions';
import { ActionMessage, buttonCls, inputCls, type MessageState } from './settings';

/**
 * 12-security §2 item 7: changes to users, roles and API keys need the password entered within 10 minutes.
 * Shown above those controls; `validUntil` (from the server) says whether the window is open.
 */
export function StepUpCard({ validUntil }: { validUntil: string | null }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(confirmPasswordAction, null);
  if (validUntil)
    return (
      <p role="status" data-testid="step-up-ok" className="flex items-center gap-2 text-[14px] text-brand-ink">
        <ShieldCheck size={16} aria-hidden /> ยืนยันรหัสผ่านแล้ว · ทำรายการได้ถึง {validUntil}
      </p>
    );
  return (
    <form
      action={action}
      data-testid="step-up"
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface-muted p-4"
    >
      <label htmlFor="step-up-password" className="text-[14px] font-semibold">
        ยืนยันรหัสผ่านของคุณก่อนจัดการสิทธิ์ (ใช้ได้ 10 นาที)
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="step-up-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${inputCls} max-w-[320px]`}
        />
        <button type="submit" disabled={pending} className={buttonCls}>
          ยืนยันรหัสผ่าน
        </button>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}
