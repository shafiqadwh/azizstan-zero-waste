'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createRequestAction } from '../request-actions';

const HOURS = [12, 24, 48, 72];

/** BR-P2 / §6 late_entry: after the close, ask an admin for time to enter the score. */
export function LateEntryRequest({
  roundId,
  componentId,
  target,
  defaultHours,
}: {
  roundId: string;
  componentId: string;
  target: { type: 'class' | 'area'; id: string };
  defaultHours: number;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(HOURS.includes(defaultHours) ? defaultHours : 24);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => {
    if ([...reason.trim()].length < 5) return setError('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
    start(async () => {
      const r = await createRequestAction({
        type: 'late_entry',
        roundId,
        componentId,
        target,
        reason,
        payload: { hours },
      });
      if (r.ok) router.refresh();
      else setError(r.error.message);
    });
  };
  return (
    <section
      aria-label="ขออนุมัติใส่คะแนน"
      className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="late-reason" className="text-[13px] font-semibold">
          เหตุผล
        </label>
        <textarea
          id="late-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="late-hours" className="text-[13px] font-semibold">
          ขอเวลา
        </label>
        <select
          id="late-hours"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="h-11 rounded-md border border-line-strong bg-surface px-3 text-[16px]"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h} ชั่วโมง
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-danger-ink">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={send}
        className="h-12 rounded-[12px] bg-brand font-semibold text-white disabled:opacity-60"
      >
        ขออนุมัติใส่คะแนน
      </button>
    </section>
  );
}
