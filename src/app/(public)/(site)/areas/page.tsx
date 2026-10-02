import type { Metadata } from 'next';
import { publicAreas } from '@/server/public-cache';

export const metadata: Metadata = { title: 'อาคารและโซน · AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

/** 08-ux-ui §6.4: buildings/zones with description, per-round chips, term total; expands to its classes. */
export default async function AreasPage() {
  const { term, areas } = await publicAreas();
  const areaWord = term?.areaWord ?? 'อาคาร';
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6 lg:py-8">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">{areaWord}</h1>
      {areas.length === 0 ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">ยังไม่มีข้อมูล{areaWord}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {areas.map((a) => (
            <li
              key={a.areaId}
              className="rounded-[18px] border border-line bg-surface p-4"
              data-testid={`area-${a.name}`}
            >
              <details>
                <summary className="cursor-pointer list-none">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-[17px] font-bold">{a.name}</span>
                      {a.description ? (
                        <span className="block truncate text-[14px] text-ink-muted">{a.description}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] text-ink-muted">สะสม</span>
                      <span className="text-[20px] font-bold">{a.termScore ?? 'รอผล'}</span>
                    </span>
                  </span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    {a.rounds.map((r) => (
                      <span key={r.roundNo} className="rounded-full bg-surface-muted px-2.5 py-1 text-[13px]">
                        รอบที่ {r.roundNo}: {r.score ?? 'รอผล'}
                      </span>
                    ))}
                  </span>
                </summary>
                <div className="mt-3 border-t border-line pt-3">
                  <a
                    href={`/charts?type=area&id=${a.areaId}`}
                    className="mb-2 inline-block text-[14px] font-semibold text-brand-ink underline"
                  >
                    ดูกราฟพัฒนาการ
                  </a>
                  <p className="text-[13px] font-semibold text-ink-muted">ห้องเรียนที่รับผิดชอบ</p>
                  {a.classes.length === 0 ? (
                    <p className="text-[14px]">–</p>
                  ) : (
                    <ul className="text-[15px]">
                      {a.classes.map((c) => (
                        <li key={c.classId}>
                          {c.roomNumber ? `${c.roomNumber} · ` : ''}
                          {c.display}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
