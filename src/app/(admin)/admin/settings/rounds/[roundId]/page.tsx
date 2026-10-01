import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReadOnlyBanner } from '@/components/app/settings';
import { formatTermLabel, formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError } from '@/server/errors';
import { can } from '@/server/policies';
import { getRoundAreas, type RoundAreasView } from '@/server/services/round.service';
import { AreaRow } from './AreaRow';

export const metadata: Metadata = { title: 'พื้นที่ของห้องเรียนในรอบ · AZIZSTAN ZERO WASTE' };

const STATUS = {
  scheduled: 'ยังไม่เปิด',
  open: 'เปิดลงคะแนน',
  closed: 'ปิดรับคะแนน',
  finalized: 'ปิดรอบแล้ว',
} as const;

/** BR-R1 / BR-R4 / Q17: the building (or zone) each class belongs to in this round, frozen when it opened. */
export default async function RoundAreasPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const user = await requirePageUser(`/admin/settings/rounds/${roundId}`);
  let view: RoundAreasView;
  try {
    view = await getRoundAreas(getDb(), user, roundId);
  } catch (err) {
    if (err instanceof AppError && (err.code === 'NOT_FOUND' || err.code === 'VALIDATION')) notFound();
    throw err;
  }
  const { round, term, rows, areas } = view;
  const groups = [...new Set(rows.map((r) => r.rankGroup))];
  const areaWord = term.areaType === 'building' ? 'อาคาร' : 'โซน';

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <a href={`/admin/settings/scoring?term=${term.id}`} className="text-[14px] text-brand-ink underline">
          ← ส่วนคะแนนและรอบ
        </a>
        <h1 className="mt-2 text-[20px] leading-[1.3] font-bold lg:text-[26px]">
          {areaWord}ของห้องเรียน · รอบที่ {round.roundNo}
        </h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          {formatTermLabel(term.termNo, term.academicYear)} · {STATUS[round.status]} · เปิด{' '}
          {formatThaiDateTime(round.opensAt)}
        </p>
      </div>
      {!can(user, 'round.manage') ? <ReadOnlyBanner /> : null}
      {round.status === 'scheduled' ? (
        <p role="note" className="rounded-md bg-surface-muted px-4 py-3 text-[14px]">
          ระบบจะกำหนด{areaWord}ของแต่ละห้องเรียนเมื่อเปิดรอบ ตามห้องที่ใช้ในวันเปิดรอบ
        </p>
      ) : (
        <p role="note" className="rounded-md bg-surface-muted px-4 py-3 text-[14px]">
          {areaWord}ถูกกำหนดตอนเปิดรอบ ห้องเรียนที่ย้ายห้องหลังจากนั้นยังนับ{areaWord}เดิม แก้ได้จนกว่าจะปิดรอบ
        </p>
      )}
      {view.missing > 0 ? (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-[14px] text-danger-ink">
          ไม่มีพื้นที่ {view.missing} ห้องเรียน · ต้องกำหนดก่อนปิดรอบ
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g} aria-labelledby={`g-${g}`} className="rounded-xl border border-line bg-surface p-5">
          <h2 id={`g-${g}`} className="mb-3 text-[17px] font-bold">
            {g}
          </h2>
          <ul className="grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows
              .filter((r) => r.rankGroup === g)
              .map((r) => (
                <AreaRow
                  key={r.classId}
                  roundId={round.id}
                  classId={r.classId}
                  label={r.displayName}
                  roomNumber={r.roomNumber}
                  areaId={r.areaId}
                  scheduled={round.status === 'scheduled'}
                  areas={areas}
                  editable={view.editable}
                />
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
