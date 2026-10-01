import type { Metadata } from 'next';
import Link from 'next/link';
import { formatThaiDateTime } from '@/lib/dates';
import { publicRankings } from '@/server/public-cache';
import { RankCard } from '../RankCard';

export const metadata: Metadata = { title: 'จัดอันดับ · AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

const chip = (on: boolean) =>
  `inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-[14px] ${
    on ? 'border-brand bg-brand-soft font-semibold text-brand-ink' : 'border-line bg-surface'
  }`;

/** 08-ux-ui §6.2: ห้องเรียน / อาคาร(โซน), chips per round + "สะสมทั้งเทอม" (default). */
export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; round?: string }>;
}) {
  const sp = await searchParams;
  const roundNo = sp.round && /^\d{1,2}$/.test(sp.round) ? Number(sp.round) : null;
  const view = sp.view === 'areas' ? 'areas' : 'classes';
  const r = await publicRankings(roundNo);
  const areaWord = r.term?.areaWord ?? 'อาคาร';
  const href = (patch: { view?: string; round?: number | null }) => {
    const p = new URLSearchParams();
    const v = patch.view ?? view;
    const n = 'round' in patch ? patch.round : r.roundNo;
    if (v === 'areas') p.set('view', 'areas');
    if (n) p.set('round', String(n));
    const q = p.toString();
    return q ? `/rankings?${q}` : '/rankings';
  };
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-4 px-5 py-6 lg:px-12 lg:py-8">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">จัดอันดับ</h1>
      <nav aria-label="ประเภท" className="flex w-fit rounded-[14px] bg-[#E9E7DF] p-1">
        {(
          [
            ['classes', 'ห้องเรียน'],
            ['areas', areaWord],
          ] as const
        ).map(([v, label]) => (
          <Link
            key={v}
            href={href({ view: v })}
            aria-current={view === v ? 'page' : undefined}
            className={`rounded-[10px] px-4 py-2 text-[14px] ${view === v ? 'bg-surface font-semibold' : ''}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <nav aria-label="รอบ" className="-mx-5 flex gap-2 overflow-x-auto px-5">
        <Link
          href={href({ round: null })}
          aria-current={r.roundNo === null ? 'page' : undefined}
          className={chip(r.roundNo === null)}
        >
          สะสมทั้งเทอม
        </Link>
        {r.rounds
          .filter((x) => x.status !== 'scheduled')
          .map((x) => (
            <Link
              key={x.roundNo}
              href={href({ round: x.roundNo })}
              aria-current={r.roundNo === x.roundNo ? 'page' : undefined}
              className={chip(r.roundNo === x.roundNo)}
            >
              รอบที่ {x.roundNo}
            </Link>
          ))}
      </nav>
      {!r.hasScores ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">
          ยังไม่มีคะแนนที่อนุมัติ
          {r.closesAt ? ` · ปิดรับคะแนน ${formatThaiDateTime(new Date(r.closesAt))}` : ''}
        </p>
      ) : view === 'classes' ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {r.groups.map((g) => (
            <RankCard key={g.group} group={g.group} rows={g.rows} />
          ))}
        </div>
      ) : (
        <section
          aria-label={areaWord}
          className="rounded-[18px] border border-line bg-surface p-4"
          data-testid="rank-areas"
        >
          <ol>
            {r.areas.map((a) => (
              <li key={a.areaId} className="flex items-center gap-3 py-1.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[14px] font-bold">
                  {a.rank ?? '–'}
                </span>
                <span className="flex-1">{a.name}</span>
                <span className={`font-semibold ${a.score === null ? 'text-ink-muted' : ''}`}>{a.score ?? 'รอผล'}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
