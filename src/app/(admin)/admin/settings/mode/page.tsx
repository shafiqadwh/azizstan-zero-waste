import type { Metadata } from 'next';
import { Card, LockedBanner, ReadOnlyBanner } from '@/components/app/settings';
import { TermPicker } from '@/components/app/TermPicker';
import { formatTermLabel } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { can } from '@/server/policies';
import { resolveSettingsTerm } from '../term-context';
import { AutoApproveSwitch } from './AutoApproveSwitch';
import { ModeForm } from './ModeForm';

export const metadata: Metadata = { title: 'รูปแบบการประเมิน · AZIZSTAN ZERO WASTE' };

/** 08-ux-ui §6.12 `/admin/settings/mode`: score format, evaluation method, evidence and edit window. */
export default async function ModePage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const user = await requirePageUser('/admin/settings/mode');
  const { terms, selected: t } = await resolveSettingsTerm(user, (await searchParams).term);
  if (!t) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 py-8 lg:px-12">
        <h1 className="text-[20px] font-bold">รูปแบบการประเมิน</h1>
        <p className="mt-4">
          ยังไม่มีภาคเรียน ·{' '}
          <a href="/admin/settings/term" className="underline">
            สร้างภาคเรียน
          </a>
        </p>
      </main>
    );
  }
  const canConfigure = can(user, 'term.configure');
  const readOnly = !canConfigure || t.status === 'closed' || t.purgedAt !== null;
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">รูปแบบการประเมิน</h1>
          <p className="mt-1 text-[14px] text-ink-muted">{formatTermLabel(t.termNo, t.academicYear)}</p>
        </div>
        <TermPicker terms={terms} selectedId={t.id} />
      </div>
      <Card title="การอนุมัติผลประเมิน" id="approval">
        <AutoApproveSwitch key={t.id} termId={t.id} enabled={t.autoApprove} disabled={readOnly} />
      </Card>
      {readOnly ? <ReadOnlyBanner /> : t.configLockedAt ? <LockedBanner /> : null}
      <ModeForm
        key={t.id}
        disabled={readOnly || t.configLockedAt !== null}
        values={{
          termId: t.id,
          areaType: t.areaType,
          roomMode: t.roomMode,
          areaMode: t.areaMode,
          scoreFormat: t.scoreFormat,
          scoreStep: t.scoreStep,
          finalMax: t.finalMax,
          photoMin: t.photoMin,
          photoMax: t.photoMax,
          commentMax: t.commentMax,
          selfEditHours: t.selfEditHours,
          lateEntryDefaultHours: t.lateEntryDefaultHours,
        }}
      />
    </main>
  );
}
