import type { RankRow } from '@/server/services/public.service';

/** One rank group: top 3, then "ดูทั้งหมด n ห้อง" expanding in place (no script). Ties share a rank badge. */
export function RankCard({ group, rows, all = true }: { group: string; rows: RankRow[]; all?: boolean }) {
  const line = (r: RankRow) => (
    <li key={r.classId} className="flex items-center gap-3 py-1.5">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
          r.rank === 1 ? 'bg-brand text-white' : 'bg-surface-muted'
        }`}
        aria-label={r.rank ? `อันดับ ${r.rank}` : 'ยังไม่มีอันดับ'}
      >
        {r.rank ?? '–'}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {r.roomNumber ? `${r.roomNumber} · ` : ''}
        {r.display}
      </span>
      <span className={`shrink-0 font-semibold ${r.score === null ? 'text-ink-muted' : ''}`}>{r.score ?? 'รอผล'}</span>
    </li>
  );
  return (
    <section
      aria-label={group}
      data-testid={`rank-${group}`}
      className="rounded-[18px] border border-line bg-surface p-4"
    >
      <h3 className="mb-1 text-[17px] font-bold">{group}</h3>
      <ol>{rows.slice(0, 3).map(line)}</ol>
      {all && rows.length > 3 ? (
        <details>
          <summary className="cursor-pointer py-1 text-[14px] font-semibold text-brand-ink">
            ดูทั้งหมด {rows.length} ห้อง
          </summary>
          <ol>{rows.slice(3).map(line)}</ol>
        </details>
      ) : null}
    </section>
  );
}
