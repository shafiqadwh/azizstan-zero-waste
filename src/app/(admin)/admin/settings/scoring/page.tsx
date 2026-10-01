import type { Metadata } from 'next';
import { LockedBanner, ReadOnlyBanner } from '@/components/app/settings';
import { TermPicker } from '@/components/app/TermPicker';
import { bangkokLocalInput, formatTermLabel } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { getTermSettings } from '@/server/services/term.service';
import { resolveSettingsTerm } from '../term-context';
import { RoundsCard } from './RoundsCard';
import { ScoringForm } from './ScoringForm';

export const metadata: Metadata = { title: 'ส่วนคะแนนและรอบ · AZIZSTAN ZERO WASTE' };

const local = bangkokLocalInput;

/** 08-ux-ui §6.12 `/admin/settings/scoring`: rounds stepper, components, per-round full marks, term maximum. */
export default async function ScoringPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const user = await requirePageUser('/admin/settings/scoring');
  const { terms, selected } = await resolveSettingsTerm(user, (await searchParams).term);
  if (!selected) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 py-8 lg:px-12">
        <h1 className="text-[20px] font-bold">ส่วนคะแนนและรอบ</h1>
        <p className="mt-4">
          ยังไม่มีภาคเรียน ·{' '}
          <a href="/admin/settings/term" className="underline">
            สร้างภาคเรียน
          </a>
        </p>
      </main>
    );
  }
  const s = await getTermSettings(getDb(), user, selected.id);
  const canConfigure = can(user, 'term.configure');
  const locked = s.term.configLockedAt !== null;
  const keyById = new Map(s.components.map((c) => [c.id, c.key]));
  const roundNoById = new Map(s.rounds.map((r) => [r.id, r.roundNo]));

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ส่วนคะแนนและรอบ</h1>
          <p className="mt-1 text-[14px] text-ink-muted">{formatTermLabel(s.term.termNo, s.term.academicYear)}</p>
        </div>
        <TermPicker terms={terms} selectedId={s.term.id} />
      </div>
      {!canConfigure ? <ReadOnlyBanner /> : locked ? <LockedBanner /> : null}

      <RoundsCard
        termId={s.term.id}
        canManage={can(user, 'round.manage')}
        countLocked={!canConfigure || locked}
        rounds={s.rounds.map((r) => ({
          id: r.id,
          roundNo: r.roundNo,
          status: r.status,
          opensAt: local(r.opensAt),
          closesAt: local(r.closesAt),
        }))}
      />

      <ScoringForm
        key={`${s.term.id}-${s.rounds.length}`}
        termId={s.term.id}
        areaLabel={s.term.areaType === 'zone' ? 'โซน' : 'อาคาร'}
        disabled={!canConfigure || locked}
        initial={s.components.map((c) => ({
          id: c.id,
          key: c.key,
          label: c.label,
          unit: c.unit,
          source: c.source,
          kind: c.kind,
          maxValue: c.maxValue,
          enabled: c.enabled,
          requiresSignature: c.requiresSignature,
        }))}
        rounds={s.rounds.map((r) => r.roundNo)}
        initialEqualMax={s.equalMax}
        initialRoundMax={s.roundMax.map((m) => ({
          roundNo: roundNoById.get(m.roundId)!,
          key: keyById.get(m.componentId)!,
          maxValue: m.maxValue,
        }))}
        initialFinalMax={s.term.finalMax}
      />
    </main>
  );
}
