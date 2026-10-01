import type { Metadata } from 'next';
import { Card, ReadOnlyBanner } from '@/components/app/settings';
import { TermPicker } from '@/components/app/TermPicker';
import { bangkokLocalInput, formatTermLabel, formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { getCommitteeOverview, type CoverageTarget } from '@/server/services/duty.service';
import { ROLE_LABEL } from '../users/labels';
import { resolveSettingsTerm } from '../term-context';
import { AssignForm } from './AssignForm';
import { DutiesImport } from './DutiesImport';
import { DutyChip } from './DutyChip';

export const metadata: Metadata = { title: 'คณะกรรมการ · AZIZSTAN ZERO WASTE' };

const STATUS = {
  none: { text: 'ยังไม่มีผู้ประเมิน', cls: 'border-danger bg-danger-soft text-danger-ink' },
  multiple: { text: 'มีผู้ประเมินซ้ำ', cls: 'border-warn-ink bg-warn-soft text-warn-ink' },
  ok: { text: '', cls: 'border-line' },
} as const;

/** 08-ux-ui §6.13 `/admin/settings/committee`: users with duty counts · coverage matrix · assign · import. */
export default async function CommitteePage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const user = await requirePageUser('/admin/settings/committee');
  const { terms, selected } = await resolveSettingsTerm(user, (await searchParams).term);
  if (!selected) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 py-8 lg:px-12">
        <h1 className="text-[20px] font-bold">คณะกรรมการ</h1>
        <p className="mt-4">
          ยังไม่มีภาคเรียน ·{' '}
          <a href="/admin/settings/term" className="underline">
            สร้างภาคเรียน
          </a>
        </p>
      </main>
    );
  }
  const now = new Date();
  const o = await getCommitteeOverview(getDb(), user, selected.id, now);
  const canManage = can(user, 'duty.manage') && o.term.status !== 'closed';
  const targetLabel = (t: CoverageTarget) => (t.roomNumber ? `${t.label} · ห้อง ${t.roomNumber}` : t.label);
  const holderNote = (h: { isFreelance: boolean; validUntil: Date | null }) =>
    h.isFreelance && h.validUntil ? `ชั่วคราวถึง ${formatThaiDateTime(h.validUntil)}` : undefined;

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">คณะกรรมการ</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            {formatTermLabel(o.term.termNo, o.term.academicYear)} · เป้าหมาย {o.counts.targets} รายการ
          </p>
        </div>
        <TermPicker terms={terms} selectedId={o.term.id} />
      </div>
      {!can(user, 'duty.manage') ? <ReadOnlyBanner /> : null}
      {o.term.status === 'closed' ? (
        <p role="note" className="rounded-md bg-surface-muted px-4 py-3 text-[14px]">
          ภาคเรียนนี้ปิดแล้ว ดูได้อย่างเดียว
        </p>
      ) : null}

      <p className="flex flex-wrap gap-2 text-[14px]" aria-label="สรุปความครอบคลุม">
        <span
          className={`rounded-full border px-3 py-1 ${o.counts.none > 0 ? STATUS.none.cls : 'border-line text-brand-ink'}`}
        >
          ยังไม่มีผู้ประเมิน {o.counts.none}
        </span>
        <span
          className={`rounded-full border px-3 py-1 ${o.counts.multiple > 0 ? STATUS.multiple.cls : 'border-line'}`}
        >
          มีผู้ประเมินซ้ำ {o.counts.multiple}
        </span>
      </p>

      {canManage ? (
        <Card title="มอบหมายหน้าที่" id="assign">
          <AssignForm
            termId={o.term.id}
            minExpiry={bangkokLocalInput(now)}
            users={o.users
              .filter((u) => u.isActive || u.role === 'teacher')
              .map((u) => ({
                id: u.id,
                label: `${u.displayName} (${u.username})${u.isActive ? '' : ' · ปิดอยู่'}`,
                isAdmin: u.role === 'admin' || u.role === 'super_admin',
              }))}
            groups={o.groups.map((g) => ({
              title: g.title,
              targets: g.targets.map((t) => ({ value: `${t.targetType}:${t.id}`, label: targetLabel(t) })),
            }))}
          />
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section aria-labelledby="people" className="rounded-xl border border-line bg-surface p-5 lg:self-start">
          <h2 id="people" className="mb-3 text-[17px] font-bold">
            ผู้ใช้
          </h2>
          <ul className="flex flex-col divide-y divide-line">
            {o.users.map((u) => (
              <li key={u.id} className="flex min-w-0 items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{u.displayName}</span>
                  <span className="block truncate text-[12px] text-ink-muted">
                    {ROLE_LABEL[u.role]}
                    {u.isActive ? '' : ' · ปิดอยู่'}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[13px]">
                  <span className="block">ประเมิน {u.committeeCount}</span>
                  {u.approverCount > 0 ? <span className="block text-ink-muted">อนุมัติ {u.approverCount}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="coverage" className="min-w-0 rounded-xl border border-line bg-surface p-5">
          <h2 id="coverage" className="mb-1 text-[17px] font-bold">
            ความครอบคลุม
          </h2>
          <p className="mb-3 text-[13px] text-ink-muted">
            ผู้อนุมัติทุกรายการ:{' '}
            {o.generalApprovers.length > 0
              ? o.generalApprovers.map((a) => a.displayName).join(', ')
              : 'ไม่ได้กำหนด (แอดมินทุกคนอนุมัติได้)'}
          </p>
          {o.groups.length === 0 ? (
            <p className="py-4">
              ยังไม่มีห้องเรียนหรือพื้นที่ในภาคเรียนนี้ ·{' '}
              <a href="/admin/settings/classes" className="underline">
                เลือกห้องเรียนที่ใช้
              </a>
            </p>
          ) : null}
          {o.groups.map((g) => (
            <div key={g.title} className="mt-4">
              <h3 className="text-[15px] font-bold text-brand-ink">{g.title}</h3>
              <ul className="mt-2 grid items-start gap-2 sm:grid-cols-2">
                {g.targets.map((t) => (
                  <li
                    key={t.id}
                    data-testid={`target-${t.label}`}
                    className={`flex min-w-0 flex-col gap-2 rounded-lg border p-3 ${STATUS[t.status].cls}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="font-semibold text-ink">{targetLabel(t)}</span>
                      {t.status !== 'ok' ? (
                        <span className="text-[13px] font-semibold">{STATUS[t.status].text}</span>
                      ) : null}
                    </div>
                    {t.committee.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5" aria-label={`ผู้ประเมิน ${t.label}`}>
                        {t.committee.map((h) => (
                          <DutyChip
                            key={h.dutyId}
                            dutyId={h.dutyId}
                            name={h.displayName}
                            target={t.label}
                            note={holderNote(h)}
                            canManage={canManage}
                          />
                        ))}
                      </ul>
                    ) : null}
                    {t.approvers.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5 text-ink" aria-label={`ผู้อนุมัติ ${t.label}`}>
                        {t.approvers.map((h) => (
                          <DutyChip
                            key={h.dutyId}
                            dutyId={h.dutyId}
                            name={h.displayName}
                            target={t.label}
                            note="ผู้อนุมัติ"
                            canManage={canManage}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {o.expired.length > 0 ? (
            <details className="mt-5 text-[14px]">
              <summary className="cursor-pointer font-semibold">
                มอบหมายชั่วคราวที่หมดอายุแล้ว ({o.expired.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-ink-muted">
                {o.expired.map((e) => (
                  <li key={e.dutyId}>
                    {e.displayName} · {e.target} · หมดอายุ {e.validUntil ? formatThaiDateTime(e.validUntil) : '–'}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </div>

      {canManage ? (
        <Card title="นำเข้าจาก Excel" id="import">
          <DutiesImport termId={o.term.id} />
        </Card>
      ) : null}
    </main>
  );
}
