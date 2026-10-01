'use client';

import { useState, useTransition } from 'react';
import { TargetBadge } from '@/components/app/TargetBadge';
import { formatThaiDateTime } from '@/lib/dates';
import type { RequestCard } from '@/server/services/request.service';
import { approveRequestAction, rejectRequestAction } from './actions';

const HOURS = [12, 24, 48, 72];

/** 08-ux-ui §6.11 request card: type pill, requester, target, old → new, reason, approve / reject. */
export function RequestCardView({
  card,
  canDecide,
  defaultHours,
}: {
  card: RequestCard;
  canDecide: boolean;
  defaultHours: number;
}) {
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(HOURS.includes(defaultHours) ? defaultHours : 24);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = approve
        ? await approveRequestAction(card.id, card.evaluationId, {
            note: note || undefined,
            grantHours: card.type === 'late_entry' ? hours : undefined,
          })
        : await rejectRequestAction(card.id, card.evaluationId, note || undefined);
      if (r.ok) setDone(approve ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว');
      else setError(r.error.message);
    });
  return (
    <li
      className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4"
      data-testid={`request-${card.target.label}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-warn-soft px-2.5 py-1 text-[13px] font-semibold text-warn-ink">
          {card.typeLabel}
        </span>
        <TargetBadge roomNumber={card.target.roomNumber} label={card.target.label} className="font-semibold" />
      </div>
      <p className="text-[14px] text-ink-muted">
        {card.requesterName} · {formatThaiDateTime(card.createdAt)}
      </p>
      <p className="text-[16px]" data-testid="request-change">
        {card.oldValue !== null ? (
          <>
            <s className="text-ink-muted">{card.oldValue}</s> → <b>{card.newValue}</b>
          </>
        ) : (
          <b>{card.newValue}</b>
        )}
      </p>
      {card.addedPhotos.length + card.removedPhotos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {card.removedPhotos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- permission-checked API image
            <img key={src} src={src} alt="รูปที่ขอลบ" className="size-16 rounded-lg object-cover opacity-50" />
          ))}
          {card.addedPhotos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- permission-checked API image
            <img
              key={src}
              src={src}
              alt="รูปที่ขอเพิ่ม"
              className="size-16 rounded-lg border-2 border-brand object-cover"
            />
          ))}
        </div>
      ) : null}
      <p className="text-[14px]">เหตุผล: {card.reason}</p>
      {done ? (
        <p role="status" className="font-semibold text-brand-ink">
          {done}
        </p>
      ) : canDecide ? (
        <div className="flex flex-col gap-2">
          {card.type === 'late_entry' ? (
            <label className="flex items-center gap-2 text-[14px]">
              ให้ใส่คะแนนได้
              <select
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="h-10 rounded-md border border-line-strong bg-surface px-2"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h} ชม.
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            หมายเหตุ (ไม่บังคับ)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[15px] font-normal"
            />
          </label>
          {error ? (
            <p role="alert" className="text-[14px] text-danger-ink">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(true)}
              className="h-11 flex-1 rounded-[12px] bg-brand font-semibold text-white disabled:opacity-60"
            >
              อนุมัติการแก้ไข
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(false)}
              className="h-11 rounded-[12px] border border-line-strong px-4 font-semibold disabled:opacity-60"
            >
              ปฏิเสธ
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
