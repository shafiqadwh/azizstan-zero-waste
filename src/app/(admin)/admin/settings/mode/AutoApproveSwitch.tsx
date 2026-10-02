'use client';

import { useState, useTransition } from 'react';
import { ActionMessage, type MessageState } from '@/components/app/settings';
import { setAutoApproveAction } from './actions';

/**
 * "อนุมัติอัตโนมัติ" (2026-10-02): on → a committee evaluation is approved and its PDF issued as soon as it is
 * saved; requests (late entry, edits after the window, delete) still wait for an admin. Changeable any time.
 */
export function AutoApproveSwitch({
  termId,
  enabled,
  disabled,
}: {
  termId: string;
  enabled: boolean;
  disabled: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [state, setState] = useState<MessageState | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={disabled || pending}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            start(async () => {
              const r = await setAutoApproveAction(termId, next);
              if (!r.ok) setOn(!next);
              setState(r);
            });
          }}
          className="size-5 accent-[var(--brand)]"
        />
        <span className="font-semibold">อนุมัติอัตโนมัติ</span>
      </label>
      <p className="text-[14px] text-ink-muted">
        {on
          ? 'เปิดอยู่: ผลประเมินที่กรรมการบันทึกจะอนุมัติและออก PDF ทันที กรรมการยังแก้ไขเองได้ภายในเวลาที่กำหนด (ออก PDF ฉบับใหม่ให้) ส่วนคำขอต่าง ๆ ยังต้องให้ผู้ดูแลพิจารณา'
          : 'ปิดอยู่: ผลประเมินต้องรอผู้ดูแลอนุมัติก่อนนับคะแนนและออก PDF'}
      </p>
      <ActionMessage state={state} />
    </div>
  );
}
