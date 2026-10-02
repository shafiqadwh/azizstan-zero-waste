'use client';

import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { TargetBadge } from '@/components/app/TargetBadge';
import { formatThaiDateTime } from '@/lib/dates';
import type { ResultCard } from '@/server/services/dashboard.service';
import { approveEvaluationAction, returnEvaluationAction } from './actions';

const label = (c: ResultCard) => (c.target.roomNumber ? `${c.target.roomNumber} · ${c.target.label}` : c.target.label);

/**
 * 08-ux-ui §6.11 result cards. Desktop keyboard: J / K next / previous, A approve, R return (opens the reason
 * sheet). Decided cards leave the list on the next refresh; the notice above keeps a link to the evaluation.
 */
export function ResultCards({ cards }: { cards: ResultCard[] }) {
  const [focus, setFocus] = useState(0);
  const [returning, setReturning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const current = cards[Math.min(focus, cards.length - 1)];

  const approve = useCallback(
    (c: ResultCard) =>
      start(async () => {
        const r = await approveEvaluationAction(c.id, c.version);
        if (r.ok) {
          setNotice({ id: c.id, text: `อนุมัติ ${label(c)} แล้ว กำลังสร้าง PDF` });
          setErrors((e) => ({ ...e, [c.id]: '' }));
        } else setErrors((e) => ({ ...e, [c.id]: r.error.message }));
      }),
    [],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || returning) return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const key = ev.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        ev.preventDefault();
        setFocus((f) => {
          const next = Math.max(0, Math.min(cards.length - 1, f + (key === 'j' ? 1 : -1)));
          refs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (key === 'a' && current?.canDecide && !pending) {
        ev.preventDefault();
        approve(current);
      } else if (key === 'r' && current?.canDecide) {
        ev.preventDefault();
        setReturning(current.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cards.length, current, pending, returning, approve]);

  return (
    <div className="flex flex-col gap-3">
      {notice ? (
        <p role="status" className="rounded-md bg-brand-soft px-4 py-3 text-[14px] text-brand-ink">
          {notice.text} ·{' '}
          <Link href={`/evaluate/${notice.id}`} className="font-semibold underline">
            ดูผลประเมิน
          </Link>
        </p>
      ) : null}
      {cards.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6">ไม่มีผลประเมินที่รออนุมัติ</p>
      ) : (
        <>
          <p className="hidden text-[13px] text-ink-muted lg:block">
            แป้นพิมพ์: J / K เลื่อนการ์ด · A อนุมัติ · R ส่งกลับ
          </p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {cards.map((c, i) => (
              <li
                key={c.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-testid={`result-${c.target.label}`}
                aria-current={i === focus ? 'true' : undefined}
                onClick={() => setFocus(i)}
                className={`flex flex-col gap-3 rounded-[18px] border bg-surface p-4 ${
                  i === focus ? 'border-brand ring-2 ring-brand/30' : 'border-line'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <TargetBadge roomNumber={c.target.roomNumber} label={c.target.label} className="font-semibold" />
                    <p className="text-[14px] text-ink-muted">
                      รอบที่ {c.roundNo} · {c.componentLabel}
                    </p>
                    <p className="text-[14px] text-ink-muted">
                      {c.ownerName} · {formatThaiDateTime(c.submittedAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[32px] leading-none font-bold" data-testid="result-score">
                      {c.score === null ? '–' : `${c.deduction ? '−' : ''}${c.score}`}
                      <span className="text-[15px] font-normal text-ink-muted">
                        {c.deduction ? ` หักได้สูงสุด ${c.max}` : ` / ${c.max}`}
                      </span>
                    </p>
                    {c.students.length > 0 ? (
                      <p className="mt-1 text-[13px] text-ink-muted">เฉลี่ยจาก {c.students.length} คน</p>
                    ) : null}
                  </div>
                </div>
                {c.students.length > 0 ? (
                  <details>
                    <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-brand-ink">
                      คะแนนรายคน ({c.students.length} คน)
                    </summary>
                    {/* codes only — names are never shown (FR-S1) */}
                    <ul className="grid grid-cols-2 gap-x-4 text-[14px] tabular-nums md:grid-cols-4">
                      {c.students.map((st) => (
                        <li key={st.code} className="flex justify-between border-b border-line py-1">
                          <span>{st.code}</span>
                          <b>{st.score}</b>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {c.photos.length > 0 ? (
                  <div className="grid grid-cols-6 gap-1.5">
                    {c.photos.slice(0, 6).map((p) => (
                      <div key={p.id} className="relative aspect-square overflow-hidden rounded-md bg-surface-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API image */}
                        <img
                          src={p.thumb}
                          alt={p.kind === 'signature' ? 'ใบลงชื่อนักเรียน' : 'รูปสถานที่'}
                          loading="lazy"
                          className="size-full object-cover"
                        />
                        {p.kind === 'signature' ? (
                          <FileText
                            size={16}
                            aria-hidden
                            className="absolute right-1 bottom-1 rounded bg-surface/90 p-0.5"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {c.comment ? <p className="line-clamp-2 text-[14px]">{c.comment}</p> : null}
                {errors[c.id] ? (
                  <p role="alert" className="text-[14px] text-danger-ink">
                    {errors[c.id]}
                  </p>
                ) : null}
                {c.canDecide ? (
                  returning === c.id ? (
                    <ReturnSheet
                      card={c}
                      onCancel={() => setReturning(null)}
                      onDone={() => {
                        setReturning(null);
                        setNotice({ id: c.id, text: `ส่งกลับ ${label(c)} ให้แก้แล้ว` });
                      }}
                    />
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => approve(c)}
                        className="h-11 flex-1 rounded-[12px] bg-brand font-semibold text-white disabled:opacity-60"
                      >
                        อนุมัติและออก PDF
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setReturning(c.id)}
                        className="h-11 rounded-[12px] border border-line-strong px-4 font-semibold disabled:opacity-60"
                      >
                        ส่งกลับ
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReturnSheet({ card, onCancel, onDone }: { card: ResultCard; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="ส่งกลับให้แก้"
      className="flex flex-col gap-2 rounded-[12px] bg-surface-muted p-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        start(async () => {
          const r = await returnEvaluationAction(card.id, card.version, reason);
          if (r.ok) onDone();
          else setError(r.error.message);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        เหตุผลที่ส่งกลับ
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          rows={2}
          className="rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] font-normal"
        />
      </label>
      {error ? (
        <p role="alert" className="text-[14px] text-danger-ink">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="h-11 flex-1 rounded-[12px] bg-danger font-semibold text-white disabled:opacity-60"
        >
          ส่งกลับ
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-[12px] border border-line-strong bg-surface px-4 font-semibold"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
