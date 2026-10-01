import type { Metadata } from 'next';
import Link from 'next/link';
import { ReadOnlyBanner } from '@/components/app/settings';
import { TargetBadge } from '@/components/app/TargetBadge';
import { formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { findActiveTerm } from '@/server/repositories/places.repository';
import {
  listRequestLog,
  REQUEST_LABEL,
  REQUEST_STATUS_LABEL,
  REQUEST_TYPES,
  type RequestLogFilters,
  type RequestType,
} from '@/server/services/request.service';
import { RequestCardView } from '../approvals/RequestCardView';

export const metadata: Metadata = { title: 'บันทึกคำขอ · AZIZSTAN ZERO WASTE' };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const STATUSES = Object.keys(REQUEST_STATUS_LABEL) as (keyof typeof REQUEST_STATUS_LABEL)[];
const selectCls = 'h-10 rounded-md border border-line-strong bg-surface px-2 text-[15px] font-normal';

/** 08-ux-ui §6.18: every request of the term, newest first; waiting rows keep approve / reject (admin). */
export default async function RequestLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePageUser('/admin/requests');
  const sp = await searchParams;
  const status = one(sp.status);
  const type = one(sp.type);
  const f: RequestLogFilters = {
    status: STATUSES.includes(status as never) ? (status as RequestLogFilters['status']) : undefined,
    type: REQUEST_TYPES.includes(type as RequestType) ? (type as RequestType) : undefined,
    requester: one(sp.requester),
    round: one(sp.round),
  };
  const db = getDb();
  const [log, term] = await Promise.all([listRequestLog(db, user, f), findActiveTerm(db)]);
  const canDecide = can(user, 'request.decide');
  const filtered = Boolean(f.status || f.type || f.requester || f.round);
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-5 px-5 py-8 lg:px-12">
      <div>
        <Link href="/admin" className="text-[14px] text-brand-ink underline">
          ← ภาพรวม
        </Link>
        <h1 className="mt-2 text-[20px] leading-[1.3] font-bold lg:text-[26px]">บันทึกคำขอ</h1>
      </div>
      {!canDecide ? <ReadOnlyBanner /> : null}
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-[14px] border border-line bg-surface p-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          สถานะ
          <select name="status" defaultValue={f.status ?? ''} className={selectCls}>
            <option value="">ทั้งหมด</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ประเภท
          <select name="type" defaultValue={f.type ?? ''} className={selectCls}>
            <option value="">ทั้งหมด</option>
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {REQUEST_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ผู้ขอ
          <select name="requester" defaultValue={f.requester ?? ''} className={selectCls}>
            <option value="">ทั้งหมด</option>
            {log.requesters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          รอบ
          <select name="round" defaultValue={f.round ?? ''} className={selectCls}>
            <option value="">ทั้งหมด</option>
            {log.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                รอบที่ {r.roundNo}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 rounded-md bg-brand px-4 text-[14px] font-semibold text-white">
          ใช้ตัวกรอง
        </button>
        {filtered ? (
          <Link href="/admin/requests" className="px-2 py-2 text-[14px] underline">
            ล้างตัวกรอง
          </Link>
        ) : null}
      </form>
      <p className="text-[13px] text-ink-muted">{log.cards.length} รายการ</p>
      {log.cards.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6">ไม่มีคำขอ</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {log.cards.map((c) =>
            c.status === 'waiting' ? (
              <RequestCardView
                key={c.id}
                card={c}
                canDecide={canDecide}
                defaultHours={term?.lateEntryDefaultHours ?? 24}
              />
            ) : (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4"
                data-testid={`log-${c.target.label}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[13px] font-semibold">
                    {c.typeLabel}
                  </span>
                  <TargetBadge roomNumber={c.target.roomNumber} label={c.target.label} className="font-semibold" />
                  <span className="ml-auto rounded-full bg-surface-muted px-2.5 py-1 text-[13px] font-semibold">
                    {REQUEST_STATUS_LABEL[c.status]}
                  </span>
                </div>
                <p className="text-[14px] text-ink-muted">
                  {c.requesterName} · {formatThaiDateTime(c.createdAt)}
                </p>
                <p className="text-[16px]">
                  {c.oldValue !== null ? (
                    <>
                      <s className="text-ink-muted">{c.oldValue}</s> → <b>{c.newValue}</b>
                    </>
                  ) : (
                    <b>{c.newValue}</b>
                  )}
                </p>
                <p className="text-[14px]">เหตุผล: {c.reason}</p>
                {c.decidedAt ? (
                  <p className="text-[13px] text-ink-muted">
                    {c.decidedByName ? `${c.decidedByName} · ` : ''}
                    {formatThaiDateTime(c.decidedAt)}
                    {c.decisionNote ? ` · ${c.decisionNote}` : ''}
                  </p>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </main>
  );
}
