import type { Metadata } from 'next';
import { publicAreas, publicClasses, publicSeries } from '@/server/public-cache';
import { ChartPicker } from './ChartPicker';
import { SeriesChart } from './SeriesChart';

export const metadata: Metadata = { title: 'กราฟพัฒนาการ · AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

/** 08-ux-ui §6.5: totals per round of the current term for one class or one building/zone, with a table view. */
export default async function ChartsPage({ searchParams }: { searchParams: Promise<{ type?: string; id?: string }> }) {
  const sp = await searchParams;
  const type = sp.type === 'area' ? 'area' : sp.type === 'class' ? 'class' : null;
  const id = sp.id && UUID.test(sp.id) ? sp.id : null;
  const [classes, areaList] = await Promise.all([publicClasses(), publicAreas()]);
  const series = type && id ? await publicSeries(type, id) : null;
  const areaWord = areaList.term?.areaWord ?? 'อาคาร';

  return (
    <main className="mx-auto flex max-w-[860px] flex-col gap-4 px-5 py-6 lg:py-8">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">กราฟพัฒนาการ</h1>
      <p className="text-[14px] text-ink-muted">คะแนนรวมของแต่ละรอบในภาคเรียนนี้ เฉพาะคะแนนที่อนุมัติแล้ว</p>
      {classes.length === 0 && areaList.areas.length === 0 ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">ยังไม่มีข้อมูลในภาคเรียนนี้</p>
      ) : (
        <ChartPicker
          classes={classes}
          areas={areaList.areas.map((a) => ({ areaId: a.areaId, name: a.name }))}
          areaWord={areaWord}
          selected={series ? `${series.type}:${series.id}` : null}
        />
      )}
      {type && id && !series ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">
          ไม่พบห้องเรียนหรือพื้นที่นี้ในภาคเรียนนี้
        </p>
      ) : null}
      {series ? (
        <section
          aria-labelledby="series-title"
          className="rounded-[18px] border border-line bg-surface p-4"
          data-testid="series"
        >
          <h2 id="series-title" className="text-[19px] font-bold">
            {series.title}
          </h2>
          {series.points.length === 0 ? (
            <p className="mt-2 text-[14px] text-ink-muted">ยังไม่มีรอบที่เริ่มประเมิน</p>
          ) : (
            <SeriesChart title={series.title} points={series.points} yMax={series.yMax} />
          )}
        </section>
      ) : null}
    </main>
  );
}
