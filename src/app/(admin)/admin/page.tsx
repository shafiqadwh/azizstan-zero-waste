import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AutoRefresh } from '@/components/app/AutoRefresh';
import { InstallPrompt } from '@/components/app/InstallPrompt';
import { PushControls } from '@/components/app/PushControls';
import { ReadOnlyBanner } from '@/components/app/settings';
import { StatusPill } from '@/components/app/StatusPill';
import { TargetBadge } from '@/components/app/TargetBadge';
import { formatTermLabel, formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { homeFor } from '@/server/auth/redirects';
import { getDb } from '@/server/db';
import { isStaffRole } from '@/server/policies';
import { getDashboard } from '@/server/services/dashboard.service';
import { getSetupChecklist } from '@/server/services/setup.service';
import { RemindButton } from './RemindButton';
import { SetupChecklist } from './SetupChecklist';
import { FinalizeRound } from './settings/rounds/[roundId]/FinalizeRound';

export const metadata: Metadata = { title: 'ภาพรวม · AZIZSTAN ZERO WASTE' };

const SETTINGS = [
  ['/monitor', 'ติดตามสถานะ'],
  ['/admin/requests', 'บันทึกคำขอ'],
  ['/admin/settings/term', 'ภาคเรียน'],
  ['/admin/settings/mode', 'รูปแบบการประเมิน'],
  ['/admin/settings/scoring', 'ส่วนคะแนนและรอบ'],
  ['/admin/settings/classes', 'ห้องเรียน อาคาร และหมายเลขห้อง'],
  ['/admin/settings/committee', 'คณะกรรมการ'],
  ['/admin/settings/users', 'ผู้ใช้และสิทธิ์'],
  ['/admin/settings/students', 'นักเรียน'],
  ['/admin/settings/content', 'หน้าสาธารณะ'],
  ['/admin/settings/api', 'การเชื่อมต่อ API'],
  ['/admin/settings/privacy', 'ข้อมูลและความเป็นส่วนตัว'],
  ['/admin/audit', 'ประวัติการทำรายการ'],
] as const;

const SYNC_STATUS: Record<string, string> = { success: 'สำเร็จ', aborted: 'หยุดอัตโนมัติ', failed: 'ล้มเหลว' };

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[18px] border border-line bg-surface p-4">
      <p className="text-[14px] text-ink-muted">{label}</p>
      <p className="mt-1 text-[28px] leading-tight font-bold">{value}</p>
      {note ? <p className="text-[13px] text-ink-muted">{note}</p> : null}
    </div>
  );
}

/** 08-ux-ui §6.10 "ภาพรวม": KPIs, targets without a score, waiting approvals; refreshed every 30 s. */
export default async function AdminHomePage() {
  const user = await requirePageUser('/admin');
  // layouts and pages render in parallel: repeat the layout's guard so a teacher never reaches the service
  if (!isStaffRole(user.role)) redirect(homeFor(user.role));
  const d = await getDashboard(getDb(), user, new Date());
  const setup = d.canAct ? await getSetupChecklist(getDb(), user) : null;
  const areaWord = d.term?.areaType === 'zone' ? 'โซน' : 'อาคาร';
  const roundLine = d.term
    ? [
        formatTermLabel(d.term.termNo, d.term.academicYear),
        d.round ? `รอบที่ ${d.round.roundNo}` : null,
        d.round ? `ปิดรับคะแนน ${formatThaiDateTime(d.round.closesAt)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'ยังไม่มีภาคเรียนที่ใช้งาน';

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <AutoRefresh />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ภาพรวม</h1>
          <p className="mt-1 text-[14px] text-ink-muted">{roundLine}</p>
          {d.round ? (
            <a
              href={`/api/v1/exports/round/${d.round.id}/pdfs.pdf`}
              className="mt-1 inline-block text-[14px] font-semibold text-brand-ink underline"
            >
              PDF ทั้งรอบ (ไฟล์เดียว)
            </a>
          ) : null}
        </div>
        {d.canAct && d.round ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <RemindButton />
            <FinalizeRound roundId={d.round.id} blocker={d.finalizeBlocker} />
          </div>
        ) : null}
      </div>
      {!d.canAct ? <ReadOnlyBanner /> : null}
      {setup ? <SetupChecklist steps={setup} /> : null}
      <InstallPrompt />
      {process.env.VAPID_PUBLIC_KEY ? <PushControls vapidKey={process.env.VAPID_PUBLIC_KEY} /> : null}

      <section aria-label="ตัวชี้วัด" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="ห้องที่มีคะแนนแล้ว" value={`${d.kpi.classesDone}/${d.kpi.classesTotal}`} />
        <Kpi label={`${areaWord}ที่มีคะแนนแล้ว`} value={`${d.kpi.areasDone}/${d.kpi.areasTotal}`} />
        <Kpi
          label="รออนุมัติ"
          value={String(d.kpi.waitingResults + d.kpi.waitingRequests)}
          note={`ผล ${d.kpi.waitingResults} · คำขอ ${d.kpi.waitingRequests}`}
        />
        <Kpi label="เลยกำหนด" value={String(d.kpi.overdue)} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="missing-title" className="min-w-0 rounded-[18px] border border-line bg-surface p-4">
          <h2 id="missing-title" className="mb-3 text-[17px] font-bold">
            ยังไม่มีคะแนน {d.missing.length}
          </h2>
          {d.missing.length === 0 ? (
            <p className="text-[14px] text-ink-muted">
              {d.round ? 'ทุกรายการมีคะแนนที่อนุมัติแล้ว' : 'ยังไม่มีรอบที่เปิดลงคะแนน'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">ห้อง/พื้นที่</th>
                    <th className="py-2 pr-3 font-medium">กรรมการ</th>
                    <th className="py-2 font-medium">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {d.missing.map((m) => (
                    <tr key={m.key} className="border-t border-line" data-testid={`missing-${m.target.label}`}>
                      <td className="py-2 pr-3">
                        {m.evaluationId ? (
                          <Link href={`/evaluate/${m.evaluationId}`} className="font-semibold underline">
                            <TargetBadge roomNumber={m.target.roomNumber} label={m.target.label} />
                          </Link>
                        ) : (
                          <TargetBadge
                            roomNumber={m.target.roomNumber}
                            label={m.target.label}
                            className="font-semibold"
                          />
                        )}
                        <span className="block text-[13px] text-ink-muted">{m.componentLabel}</span>
                      </td>
                      <td className="py-2 pr-3">{m.committee.length ? m.committee.join(', ') : 'ยังไม่มีกรรมการ'}</td>
                      <td className="py-2">
                        <StatusPill status={m.late ? 'late' : m.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="waiting-title" className="rounded-[18px] border border-line bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="waiting-title" className="text-[17px] font-bold">
                รออนุมัติ
              </h2>
              <Link href="/admin/approvals" className="text-[14px] font-semibold text-brand-ink underline">
                ดูทั้งหมด
              </Link>
            </div>
            {d.waiting.length === 0 ? (
              <p className="text-[14px] text-ink-muted">ไม่มีผลประเมินที่รออนุมัติ</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.waiting.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/evaluate/${c.id}`}
                      className="flex items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2 hover:bg-surface-muted"
                    >
                      <span className="min-w-0">
                        <TargetBadge
                          roomNumber={c.target.roomNumber}
                          label={c.target.label}
                          className="block truncate font-semibold"
                        />
                        <span className="block text-[13px] text-ink-muted">
                          {c.ownerName} · {formatThaiDateTime(c.submittedAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[20px] font-bold">
                        {c.score ?? 'รายคน'}
                        <span className="text-[13px] font-normal text-ink-muted">/{c.max}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {d.kpi.waitingRequests > 0 ? (
              <Link
                href="/admin/approvals?tab=requests"
                className="mt-3 block text-[14px] font-semibold text-brand-ink underline"
              >
                คำขอรออนุมัติ {d.kpi.waitingRequests} รายการ
              </Link>
            ) : null}
          </section>

          <section aria-labelledby="sync-title" className="rounded-[18px] border border-line bg-surface p-4">
            <h2 id="sync-title" className="mb-2 text-[17px] font-bold">
              Sync รายชื่อนักเรียน
            </h2>
            {d.sync ? (
              <p className="text-[14px]">
                ล่าสุด {formatThaiDateTime(d.sync.finishedAt ?? d.sync.startedAt)} ·{' '}
                {d.sync.status ? SYNC_STATUS[d.sync.status] : 'กำลังทำงาน'}
                {d.sync.error ? <span className="block text-danger-ink">{d.sync.error}</span> : null}
              </p>
            ) : (
              <p className="text-[14px] text-ink-muted">ยังไม่เคย sync รายชื่อ</p>
            )}
          </section>
        </div>
      </div>

      <nav aria-label="ตั้งค่า" className="flex flex-wrap gap-2">
        {SETTINGS.map(([href, text]) => (
          <Link
            key={href}
            href={href}
            className="inline-flex h-11 items-center rounded-md border border-line-strong bg-surface px-4 font-medium hover:bg-surface-muted"
          >
            {text}
          </Link>
        ))}
      </nav>
    </main>
  );
}
