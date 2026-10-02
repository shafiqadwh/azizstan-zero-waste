'use client';

import { CircleCheck, ChevronRight, QrCode, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { StatusPill } from '@/components/app/StatusPill';
import { TargetBadge } from '@/components/app/TargetBadge';
import type { TaskItem } from '@/server/services/task.service';

type Tab = 'todo' | 'waiting' | 'done';

const tabOf = (i: TaskItem): Tab => (i.status === 'approved' ? 'done' : i.status === 'submitted' ? 'waiting' : 'todo');
/** T41: a deduction nobody has made is not work left to do — it is listed apart, never under "ต้องทำ" */
const isSpare = (i: TaskItem) => i.optional && i.status === 'not_evaluated';

function Row({ i, testId }: { i: TaskItem; testId: string }) {
  return (
    <li>
      <Link href={i.href} className="flex min-h-16 items-center gap-3 px-4 py-3" data-testid={testId}>
        <span className="min-w-0 flex-1">
          <TargetBadge
            roomNumber={i.target.roomNumber}
            label={i.target.label}
            className="block truncate text-[16px] font-semibold"
          />
          <span className="block truncate text-[13px] text-ink-muted">
            {[i.componentLabel, i.target.subtitle, i.ownerName && !i.mine ? `โดย ${i.ownerName}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {isSpare(i) ? (
          <span className="shrink-0 rounded-full border border-line-strong px-2.5 py-1 text-[13px]">หักได้</span>
        ) : (
          <StatusPill status={i.status} />
        )}
        <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-muted" />
      </Link>
    </li>
  );
}

/** Tabs "ต้องทำ n · รออนุมัติ n · เสร็จ n" and a room-number search over the user's own targets. */
export function TaskList({ items }: { items: TaskItem[] }) {
  const [tab, setTab] = useState<Tab>('todo');
  const [q, setQ] = useState('');
  const work = items.filter((i) => !isSpare(i));
  const spare = items.filter(isSpare);
  const count = (t: Tab) => work.filter((i) => tabOf(i) === t).length;
  const query = q.trim().toLowerCase();
  const shown = query
    ? items.filter((i) => `${i.target.roomNumber ?? ''} ${i.target.label}`.toLowerCase().includes(query))
    : work.filter((i) => tabOf(i) === tab);
  const tabs: [Tab, string][] = [
    ['todo', 'ต้องทำ'],
    ['waiting', 'รออนุมัติ'],
    ['done', 'เสร็จ'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">ค้นหาห้อง</span>
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3 text-ink-muted" />
          <input
            type="search"
            inputMode="numeric"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="เลขห้อง เช่น 121"
            className="h-12 w-full rounded-md border border-line-strong bg-surface pr-3 pl-10 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </label>
        <a
          href="#scan-help"
          aria-label="สแกน QR หน้าห้อง"
          title="ใช้กล้องมือถือสแกน QR ที่ประตูห้อง"
          className="flex size-12 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface"
        >
          <QrCode size={22} aria-hidden />
        </a>
      </div>
      {!query ? (
        <div role="tablist" aria-label="สถานะ" className="flex rounded-[14px] bg-[#E9E7DF] p-1">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`h-10 flex-1 rounded-[10px] text-[14px] ${tab === key ? 'bg-surface font-semibold shadow-sm' : ''}`}
            >
              {label} {count(key)}
            </button>
          ))}
        </div>
      ) : null}
      {shown.length === 0 ? (
        tab === 'todo' && !query ? (
          <p className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-5 py-6">
            <CircleCheck size={20} aria-hidden className="text-brand" /> ครบทุกรายการแล้ว ขอบคุณครับ/ค่ะ
          </p>
        ) : (
          <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center text-ink-muted">
            {query ? 'ไม่พบห้องนี้ในรายการของคุณ' : 'ไม่มีรายการ'}
          </p>
        )
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {shown.map((i) => (
            <Row
              key={i.key}
              i={i}
              testId={`${isSpare(i) ? 'deduct' : 'task'}-${i.target.roomNumber ?? i.target.label}`}
            />
          ))}
        </ul>
      )}
      {!query && spare.length > 0 ? (
        <section aria-labelledby="spare-title" className="flex flex-col gap-2">
          <h2 id="spare-title" className="text-[16px] font-bold">
            หักคะแนน ({spare.length})
          </h2>
          <p className="text-[13px] text-ink-muted">
            ห้องในพื้นที่ที่คุณรับผิดชอบ หักได้รอบละครั้งเมื่อพบปัญหา ต้องมีรูปหลักฐานและเหตุผล ไม่ต้องทำทุกห้อง
          </p>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {spare.map((i) => (
              <Row key={i.key} i={i} testId={`deduct-${i.target.roomNumber ?? i.target.label}`} />
            ))}
          </ul>
        </section>
      ) : null}
      <p id="scan-help" className="text-[13px] text-ink-muted">
        สแกน QR ที่ประตูห้องด้วยกล้องมือถือ ระบบจะเปิดแบบประเมินของห้องนั้นให้
      </p>
    </div>
  );
}
