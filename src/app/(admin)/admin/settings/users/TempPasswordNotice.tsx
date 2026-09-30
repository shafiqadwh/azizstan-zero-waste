'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Shown once after create/reset: the temporary password is not stored anywhere readable. */
export function TempPasswordNotice({ title, tempPassword }: { title: string; tempPassword: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-md bg-brand-soft px-4 py-3 text-[14px] text-brand-ink">
      <p className="font-semibold">{title}</p>
      {tempPassword ? (
        <>
          <p className="mt-1">รหัสผ่านชั่วคราว (แสดงครั้งเดียว ผู้ใช้ต้องเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก):</p>
          <div className="mt-2 flex items-center gap-2">
            <code
              data-testid="temp-password"
              className="rounded bg-surface px-3 py-2 font-mono text-[16px] tracking-wider text-ink"
            >
              {tempPassword}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(tempPassword).then(() => setCopied(true));
              }}
              className="flex h-11 items-center gap-1.5 rounded-md border border-brand px-3 font-medium"
            >
              {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-1">บัญชีโรงเรียนใช้รหัสผ่านของระบบโรงเรียน</p>
      )}
    </div>
  );
}
