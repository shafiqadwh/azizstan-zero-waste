'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { StatusPill } from '@/components/app/StatusPill';
import { formatThaiDate, formatThaiDateTime } from '@/lib/dates';
import type { TargetDetail } from '@/server/services/monitor.service';

type Detail = Omit<TargetDetail, 'committee' | 'items'> & {
  committee: (Omit<TargetDetail['committee'][number], 'until'> & { until: string | null })[];
  items: (Omit<TargetDetail['items'][number], 'submittedAt' | 'approvedAt'> & {
    submittedAt: string | null;
    approvedAt: string | null;
  })[];
};

/**
 * §6.17 target popover "who is responsible": a real button (aria-haspopup="dialog") that opens after 300 ms of
 * hover, on keyboard focus or on tap (a bottom sheet on small screens). Loads
 * GET /api/v1/monitor/targets/{type}/{id}?round= — the same scope check as the board.
 */
export function TargetPopover({
  type,
  id,
  roundId,
  label,
  className,
  children,
}: {
  type: 'class' | 'area';
  id: string;
  roundId: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!open || detail) return;
    let alive = true;
    void fetch(`/api/v1/monitor/targets/${type}/${id}?round=${roundId}`, { cache: 'no-store' }).then(async (res) => {
      if (!alive) return;
      if (res.ok) setDetail(await res.json());
      else setError(res.status === 403 ? 'คุณไม่มีสิทธิ์ดูรายการนี้' : 'โหลดข้อมูลไม่สำเร็จ');
    });
    return () => {
      alive = false;
    };
  }, [open, detail, type, id, roundId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <span
      ref={box}
      className="relative inline-block w-full"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        clear();
        timer.current = window.setTimeout(() => setOpen(true), 300);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        clear();
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={label}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      {open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-label={`ผู้รับผิดชอบ ${label}`}
          className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-[18px] border border-line bg-surface p-4 text-left shadow-lg lg:absolute lg:inset-x-auto lg:top-full lg:bottom-auto lg:left-0 lg:mt-1 lg:w-[340px] lg:rounded-[14px]"
        >
          {error ? (
            <p role="alert" className="text-[14px] text-danger-ink">
              {error}
            </p>
          ) : !detail ? (
            <p className="text-[14px] text-ink-muted">กำลังโหลด…</p>
          ) : (
            <div className="flex flex-col gap-3 text-[14px]">
              <div>
                <p className="font-semibold">
                  {detail.target.roomNumber ? `${detail.target.roomNumber} · ` : ''}
                  {detail.target.label}
                </p>
                {detail.target.subtitle ? <p className="text-ink-muted">{detail.target.subtitle}</p> : null}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-ink-muted">กรรมการผู้รับผิดชอบ</p>
                {detail.committee.length === 0 ? (
                  <p>ยังไม่มีกรรมการ</p>
                ) : (
                  <ul>
                    {detail.committee.map((c) => (
                      <li key={c.userId}>
                        {c.name}
                        {c.until ? (
                          <span className="text-ink-muted"> (ชั่วคราว ถึง {formatThaiDate(new Date(c.until))})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {detail.items.map((i) => (
                <div key={i.componentLabel} className="flex flex-col gap-1">
                  <p className="text-[13px] font-semibold text-ink-muted">{i.componentLabel}</p>
                  <p>
                    ผู้ประเมิน:{' '}
                    {i.ownerName
                      ? `${i.ownerName}${i.submittedAt ? ` · ${formatThaiDateTime(new Date(i.submittedAt))}` : ''}`
                      : 'ยังไม่มีผู้ประเมิน'}
                  </p>
                  <span>
                    <StatusPill status={i.late ? 'late' : i.status} />
                  </span>
                  {i.approverName && i.approvedAt ? (
                    <p>
                      อนุมัติโดย {i.approverName} เมื่อ {formatThaiDateTime(new Date(i.approvedAt))}
                    </p>
                  ) : null}
                  {i.returnedReason ? <p>เหตุผลที่ส่งกลับ: {i.returnedReason}</p> : null}
                  <div className="flex gap-3">
                    {i.pdfUrl ? (
                      <a href={i.pdfUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                        PDF
                      </a>
                    ) : null}
                    {i.href ? (
                      <Link href={i.href} className="font-semibold text-brand-ink underline">
                        ดูรายละเอียด
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
              {detail.requests.length > 0 ? (
                <div>
                  <p className="text-[13px] font-semibold text-ink-muted">คำขอ</p>
                  {detail.requests.map((r, n) => (
                    <p key={n}>
                      {r.label} · {r.requesterName}
                    </p>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 rounded-md border border-line-strong font-semibold lg:hidden"
              >
                ปิด
              </button>
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}
