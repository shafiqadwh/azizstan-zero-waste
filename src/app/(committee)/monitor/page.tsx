import { AlertTriangle, Check, Circle, Clock, FileWarning, Loader, Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/app/AutoRefresh';
import { StatusPill } from '@/components/app/StatusPill';
import { formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError } from '@/server/errors';
import {
  COUNTER_LABEL,
  COUNTERS,
  getBoard,
  parseBoardQuery,
  type Board,
  type BoardRow,
} from '@/server/services/monitor.service';
import { ActivityFeed } from './ActivityFeed';
import { RetryPdfButton } from './RetryPdfButton';
import { TargetPopover } from './TargetPopover';

export const metadata: Metadata = { title: 'ติดตามสถานะ · AZIZSTAN ZERO WASTE' };

type Search = Record<string, string | string[] | undefined>;

const ROUND_STATUS: Record<string, string> = {
  scheduled: 'ยังไม่เปิด',
  open: 'เปิดลงคะแนน',
  closed: 'ปิดรับคะแนน',
  finalized: 'ปิดรอบแล้ว',
};

/** Same URL with some params replaced (undefined removes). Filters live in the URL (§6.17). */
function hrefWith(sp: Search, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) p.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const q = p.toString();
  return q ? `/monitor?${q}` : '/monitor';
}

function tileStyle(r: BoardRow) {
  if (r.late)
    return { cls: 'border-2 border-danger bg-surface text-danger-ink', Icon: AlertTriangle, text: 'เลยกำหนด' };
  switch (r.status) {
    case 'not_evaluated':
      return { cls: 'border border-dashed border-line-strong bg-surface', Icon: Circle, text: 'ยังไม่ประเมิน' };
    case 'submitted':
      return { cls: 'border border-warn-ink/30 bg-warn-soft text-warn-ink', Icon: Clock, text: r.score ?? '' };
    case 'returned':
      return { cls: 'border border-danger/30 bg-danger-soft text-danger-ink', Icon: Undo2, text: 'ส่งกลับ' };
    case 'approved':
      return { cls: 'border border-brand bg-brand text-white', Icon: Check, text: r.score ?? '' };
  }
}

function summary(rows: BoardRow[]) {
  const n = (s: BoardRow['status']) => rows.filter((r) => r.status === s).length;
  return [
    ['อนุมัติ', n('approved')],
    ['รออนุมัติ', n('submitted')],
    ['ส่งกลับ', n('returned')],
    ['ยังไม่ประเมิน', n('not_evaluated')],
  ]
    .filter(([, c]) => (c as number) > 0)
    .map(([l, c]) => `${l} ${c}`)
    .join(' · ');
}

function Tile({ r, roundId }: { r: BoardRow; roundId: string }) {
  const { cls, Icon, text } = tileStyle(r);
  const name = r.target.roomNumber ? `${r.target.roomNumber} · ${r.target.label}` : r.target.label;
  return (
    <li data-testid={`tile-${r.target.label}`} data-status={r.late ? 'late' : r.status}>
      <TargetPopover
        type={r.target.type}
        id={r.target.id}
        roundId={roundId}
        label={name}
        className={`relative flex h-[70px] w-full flex-col items-start justify-between overflow-hidden rounded-[12px] p-2 text-left ${cls}`}
      >
        <span className="w-full truncate text-[15px] leading-tight font-bold">
          {r.target.roomNumber ?? r.target.label}
        </span>
        {r.target.roomNumber ? (
          <span className="w-full truncate text-[13px] leading-tight">{r.target.label}</span>
        ) : null}
        <span className="flex items-center gap-1 text-[12px] font-semibold">
          <Icon size={13} aria-hidden /> {text}
        </span>
        {r.pdfStatus === 'queued' || r.pdfStatus === 'failed' ? (
          <span
            className="absolute top-1 right-1 rounded bg-surface px-1 text-[10px] font-bold text-ink"
            title={r.pdfStatus === 'failed' ? 'PDF ล้มเหลว' : 'กำลังสร้าง PDF'}
          >
            {r.pdfStatus === 'failed' ? (
              <FileWarning size={12} aria-label="PDF ล้มเหลว" />
            ) : (
              <Loader size={12} aria-label="กำลังสร้าง PDF" />
            )}
          </span>
        ) : null}
      </TargetPopover>
    </li>
  );
}

function RoomMap({ board }: { board: Board }) {
  const sections = [...new Set(board.rows.map((r) => r.group ?? `__area`))].map((g) => ({
    title: g === '__area' ? board.areaWord : g,
    rows: board.rows.filter((r) => (r.group ?? '__area') === g),
  }));
  return (
    <div className="flex flex-col gap-5" data-testid="room-map">
      {sections.map((s) => (
        <section key={s.title} aria-label={s.title}>
          <h3 className="text-[15px] font-bold">{s.title}</h3>
          <p className="mb-2 text-[13px] text-ink-muted">{summary(s.rows)}</p>
          <ul className="grid grid-cols-3 gap-2 lg:grid-cols-6">
            {s.rows.map((r) => (
              <Tile key={r.key} r={r} roundId={board.round!.id} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Table({ board }: { board: Board }) {
  return (
    <div className="overflow-x-auto" data-testid="board-table">
      <table className="w-full text-left text-[14px]">
        <thead className="text-ink-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">ห้อง/พื้นที่</th>
            <th className="py-2 pr-3 font-medium">ส่วนคะแนน</th>
            <th className="py-2 pr-3 font-medium">กรรมการ</th>
            <th className="py-2 pr-3 font-medium">ผู้ประเมิน</th>
            <th className="py-2 pr-3 font-medium">สถานะ</th>
            <th className="py-2 pr-3 font-medium">PDF</th>
            <th className="py-2 font-medium">คำขอ</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r) => {
            const name = r.target.roomNumber ? `${r.target.roomNumber} · ${r.target.label}` : r.target.label;
            return (
              <tr key={r.key} className="border-t border-line align-top" data-testid={`row-${r.target.label}`}>
                <td className="py-2 pr-3">
                  <TargetPopover
                    type={r.target.type}
                    id={r.target.id}
                    roundId={board.round!.id}
                    label={name}
                    className="text-left font-semibold underline decoration-dotted"
                  >
                    {name}
                  </TargetPopover>
                </td>
                <td className="py-2 pr-3">{r.componentLabel}</td>
                <td className="py-2 pr-3">{r.committee.map((c) => c.name).join(', ') || 'ยังไม่มีกรรมการ'}</td>
                <td className="py-2 pr-3">
                  {r.ownerName ? (
                    <>
                      {r.ownerName}
                      {r.submittedAt ? (
                        <span className="block text-[13px] text-ink-muted">{formatThaiDateTime(r.submittedAt)}</span>
                      ) : null}
                    </>
                  ) : (
                    '–'
                  )}
                </td>
                <td className="py-2 pr-3">
                  {r.href ? (
                    <Link href={r.href}>
                      <StatusPill status={r.late ? 'late' : r.status} />
                    </Link>
                  ) : (
                    <StatusPill status={r.late ? 'late' : r.status} />
                  )}
                  {r.score ? <span className="ml-2 font-semibold">{r.score}</span> : null}
                </td>
                <td className="py-2 pr-3">
                  {r.pdfUrl ? (
                    <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="underline">
                      PDF
                    </a>
                  ) : r.pdfStatus === 'queued' ? (
                    'กำลังสร้าง'
                  ) : r.pdfStatus === 'failed' ? (
                    <span className="flex flex-col gap-1 text-danger-ink">
                      ล้มเหลว{r.pdfError ? <span className="text-[12px]">{r.pdfError}</span> : null}
                      {board.canAct && r.evaluationId ? <RetryPdfButton evaluationId={r.evaluationId} /> : null}
                    </span>
                  ) : (
                    '–'
                  )}
                </td>
                <td className="py-2">
                  {r.waitingRequest ? (
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[13px] font-semibold text-warn-ink">
                      {r.waitingRequest}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 08-ux-ui §6.17 "ติดตามสถานะ": counters (= filters), filter bar, room map or table, activity feed. */
export default async function MonitorPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePageUser('/monitor');
  const sp = await searchParams;
  const query = parseBoardQuery(sp);
  const view = sp.view === 'table' ? 'table' : 'map';
  let board: Board;
  try {
    board = await getBoard(getDb(), user, query, new Date());
  } catch (err) {
    if (err instanceof AppError && err.code === 'FORBIDDEN')
      return (
        <main className="mx-auto max-w-[720px] px-5 py-10">
          <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center">
            หน้านี้สำหรับผู้ดูแลและกรรมการประเมินเท่านั้น
          </p>
        </main>
      );
    throw err;
  }
  const f = query.filters;
  const filtered = Boolean(f.status || f.group || f.area || f.committee || f.q || f.mine);
  const exportHref = `/api/v1/monitor/export.xlsx${hrefWith(sp, { view: undefined, round: board.round?.id }).replace('/monitor', '')}`;

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-5 px-5 py-8 lg:px-12">
      <AutoRefresh />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ติดตามสถานะ</h1>
          <p className="text-[13px] text-ink-muted">อัปเดตอัตโนมัติทุก 30 วินาที</p>
        </div>
        {board.round ? (
          <div className="flex flex-wrap items-end gap-2">
            <form method="get" className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                รอบ
                <select
                  name="round"
                  defaultValue={board.round.id}
                  className="h-10 rounded-md border border-line-strong bg-surface px-2 text-[15px] font-normal"
                >
                  {board.rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      รอบที่ {r.roundNo} · {ROUND_STATUS[r.status]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[14px]">
                เปลี่ยนรอบ
              </button>
            </form>
            <a
              href={exportHref}
              className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-3 text-[14px] font-medium"
            >
              ส่งออก Excel
            </a>
          </div>
        ) : null}
      </div>

      {!board.round ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6">ยังไม่มีรอบการประเมินในภาคเรียนนี้</p>
      ) : (
        <>
          <nav aria-label="สถานะ" className="-mx-5 overflow-x-auto px-5">
            <ul className="flex gap-2">
              {COUNTERS.map((k) => {
                const active = f.status === k;
                return (
                  <li key={k} className="shrink-0">
                    <Link
                      href={hrefWith(sp, { status: active ? undefined : k })}
                      aria-current={active ? 'true' : undefined}
                      data-testid={`counter-${k}`}
                      className={`flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] ${
                        active ? 'border-brand bg-brand-soft font-semibold text-brand-ink' : 'border-line bg-surface'
                      }`}
                    >
                      {COUNTER_LABEL[k]} <b>{board.counters[k]}</b>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <form
            method="get"
            className="flex flex-wrap items-end gap-2 rounded-[14px] border border-line bg-surface p-3"
          >
            <input type="hidden" name="round" value={board.round.id} />
            <input type="hidden" name="view" value={view} />
            {f.status ? <input type="hidden" name="status" value={f.status} /> : null}
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              ชั้นเรียน
              <select
                name="group"
                defaultValue={f.group ?? ''}
                className="h-10 rounded-md border border-line-strong bg-surface px-2 text-[15px] font-normal"
              >
                <option value="">ทั้งหมด</option>
                {board.options.groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              {board.areaWord}
              <select
                name="area"
                defaultValue={f.area ?? ''}
                className="h-10 rounded-md border border-line-strong bg-surface px-2 text-[15px] font-normal"
              >
                <option value="">ทั้งหมด</option>
                {board.options.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              กรรมการ
              <select
                name="committee"
                defaultValue={f.committee ?? ''}
                className="h-10 rounded-md border border-line-strong bg-surface px-2 text-[15px] font-normal"
              >
                <option value="">ทั้งหมด</option>
                {board.options.committee.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              ค้นหาห้อง
              <input
                name="q"
                defaultValue={f.q ?? ''}
                inputMode="numeric"
                placeholder="เลขห้อง เช่น 121"
                className="h-10 w-36 rounded-md border border-line-strong bg-surface px-2 text-[15px] font-normal"
              />
            </label>
            {board.canToggleMine ? (
              <label className="flex h-10 items-center gap-2 text-[14px]">
                <input type="checkbox" name="mine" value="1" defaultChecked={board.mine} className="size-5" />
                เฉพาะที่ฉันรับผิดชอบ
              </label>
            ) : null}
            <button type="submit" className="h-10 rounded-md bg-brand px-4 text-[14px] font-semibold text-white">
              ใช้ตัวกรอง
            </button>
            {filtered ? (
              <Link
                href={hrefWith({}, { round: board.round.id, view })}
                className="h-10 px-2 py-2 text-[14px] underline"
              >
                ล้างตัวกรอง
              </Link>
            ) : null}
            <div role="group" aria-label="มุมมอง" className="ml-auto flex rounded-[12px] bg-surface-muted p-1">
              <Link
                href={hrefWith(sp, { view: undefined })}
                aria-current={view === 'map' ? 'page' : undefined}
                className={`rounded-[10px] px-3 py-1.5 text-[14px] ${view === 'map' ? 'bg-surface font-semibold' : ''}`}
              >
                ผังห้อง
              </Link>
              <Link
                href={hrefWith(sp, { view: 'table' })}
                aria-current={view === 'table' ? 'page' : undefined}
                className={`rounded-[10px] px-3 py-1.5 text-[14px] ${view === 'table' ? 'bg-surface font-semibold' : ''}`}
              >
                ตาราง
              </Link>
            </div>
          </form>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section aria-label="รายการ" className="min-w-0 rounded-[18px] border border-line bg-surface p-4">
              <p className="mb-3 text-[13px] text-ink-muted" data-testid="row-count">
                {board.rows.length} รายการ
              </p>
              {board.rows.length === 0 ? (
                <p className="text-[14px] text-ink-muted">ไม่มีรายการที่ตรงกับตัวกรอง</p>
              ) : view === 'table' ? (
                <Table board={board} />
              ) : (
                <RoomMap board={board} />
              )}
            </section>
            <ActivityFeed roundId={board.round.id} />
          </div>
        </>
      )}
    </main>
  );
}
