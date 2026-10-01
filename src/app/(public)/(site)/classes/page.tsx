import type { Metadata } from 'next';
import { publicClasses, publicClassScores } from '@/server/public-cache';
import { ClassPicker } from './ClassPicker';

export const metadata: Metadata = { title: 'คะแนนห้องเรียน · AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

/** 08-ux-ui §6.3: pick a class, see rounds × (ห้อง, อาคาร/โซน, รวม) and the term score. No student names. */
export default async function ClassesPage({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const id = (await searchParams).class;
  const classes = await publicClasses();
  const valid = id && classes.some((c) => c.classId === id) ? id : null;
  const scores = valid ? await publicClassScores(valid) : null;
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6 lg:py-8">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">คะแนนห้องเรียน</h1>
      {classes.length === 0 ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">ยังไม่มีห้องเรียนในภาคเรียนนี้</p>
      ) : (
        <ClassPicker classes={classes} selected={valid} />
      )}
      {scores ? (
        <section
          aria-label="คะแนน"
          className="rounded-[18px] border border-line bg-surface p-4"
          data-testid="class-scores"
        >
          <h2 className="text-[19px] font-bold">
            {scores.roomNumber ? `${scores.roomNumber} · ` : ''}
            {scores.display}
          </h2>
          {scores.rounds.length === 0 ? (
            <p className="mt-2 text-[14px] text-ink-muted">ยังไม่มีรอบที่เริ่มประเมิน</p>
          ) : (
            <table className="mt-3 w-full text-left text-[15px]">
              <thead className="text-[13px] text-ink-muted">
                <tr>
                  <th className="py-2 font-medium">รอบ</th>
                  <th className="py-2 font-medium">คะแนนห้อง</th>
                  <th className="py-2 font-medium">คะแนน{scores.areaWord}</th>
                  <th className="py-2 font-medium">รวม</th>
                </tr>
              </thead>
              <tbody>
                {scores.rounds.map((r) => (
                  <tr key={r.roundNo} className="border-t border-line">
                    <td className="py-2">รอบที่ {r.roundNo}</td>
                    <td className="py-2">{r.classScore ?? 'รอผล'}</td>
                    <td className="py-2">{r.areaScore ?? 'รอผล'}</td>
                    <td className="py-2 font-semibold">{r.total ?? 'รอผล'}</td>
                  </tr>
                ))}
                <tr className="border-t border-line-strong">
                  <td className="py-2 font-semibold" colSpan={3}>
                    คะแนนสะสมทั้งเทอม
                  </td>
                  <td className="py-2 font-bold">{scores.termScore ?? 'รอผล'}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </main>
  );
}
