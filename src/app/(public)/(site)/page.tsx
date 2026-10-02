import { BookOpen, Building2, CalendarDays, ChartLine, ChevronRight, FileText, School, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/app/Logo';
import { formatTermLabel, formatThaiDateTime } from '@/lib/dates';
import { publicGuide, publicRankings, publicSummary } from '@/server/public-cache';
import type { PublicSummary } from '@/server/services/public.service';
import { RankCard } from './RankCard';

export const metadata: Metadata = { title: 'AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

function statusLine(s: PublicSummary): { dot: string; title: string; sub: string | null } {
  if (!s.term) return { dot: 'bg-line-strong', title: 'ยังไม่เปิดภาคเรียนใหม่', sub: null };
  if (s.allFinalized)
    return { dot: 'bg-brand', title: 'สรุปผลภาคเรียน', sub: formatTermLabel(s.term.termNo, s.term.academicYear) };
  const r = s.round;
  if (!r) return { dot: 'bg-line-strong', title: 'ยังไม่มีรอบการประเมิน', sub: null };
  const at = (iso: string) => formatThaiDateTime(new Date(iso));
  switch (r.status) {
    case 'scheduled':
      return { dot: 'bg-line-strong', title: `รอบที่ ${r.roundNo} เริ่ม ${at(r.opensAt)}`, sub: null };
    case 'open':
      return { dot: 'bg-brand', title: `รอบที่ ${r.roundNo} เปิดลงคะแนน`, sub: `ถึง ${at(r.closesAt)}` };
    case 'closed':
      return { dot: 'bg-warn-ink', title: `รอบที่ ${r.roundNo} ปิดรับคะแนนแล้ว`, sub: 'กำลังตรวจและสรุปผล' };
    case 'finalized':
      return { dot: 'bg-brand', title: `รอบที่ ${r.roundNo} ปิดรอบแล้ว`, sub: 'ผลคะแนนเป็นผลสุดท้าย' };
  }
}

/** 08-ux-ui §6.1: round status card, rankings tile, tiles, guide row; desktop adds every group's top 3. */
export default async function HomePage() {
  const [summary, rankings, guide] = await Promise.all([publicSummary(), publicRankings(null), publicGuide()]);
  const line = statusLine(summary);
  const p = summary.progress;
  const pct = p.classesTotal ? Math.round((p.classesDone / p.classesTotal) * 100) : 0;
  const areaWord = summary.term?.areaWord ?? 'อาคาร';
  const tiles = [
    ['/classes', 'ห้องเรียน', School],
    ['/areas', areaWord, Building2],
    ['/calendar', 'ปฏิทินการประเมิน', CalendarDays],
    ['/charts', 'กราฟพัฒนาการ', ChartLine],
    ['/orders', 'คำสั่งแต่งตั้ง', FileText],
    ['/guide', 'วิธีการใช้งานเบื้องต้น', BookOpen],
  ] as const;

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-5 px-5 py-6 lg:px-12 lg:py-8">
      <h1 className="sr-only">
        <Logo />
      </h1>
      <section aria-label="สถานะรอบ" className="rounded-[18px] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <span className={`size-2.5 rounded-full ${line.dot}`} aria-hidden />
          {line.title}
        </p>
        {line.sub ? <p className="text-[14px] text-ink-muted">{line.sub}</p> : null}
        {summary.round && summary.round.status !== 'scheduled' && !summary.allFinalized ? (
          <>
            <p className="mt-3 text-[28px] leading-tight font-bold" data-testid="progress">
              {p.classesDone} จาก {p.classesTotal} ห้องประเมินแล้ว
            </p>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-label="ความคืบหน้า"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
            {p.areasTotal ? (
              <p className="mt-2 text-[14px] text-ink-muted">
                {areaWord}ที่มีคะแนนแล้ว {p.areasDone}/{p.areasTotal}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <Link
        href="/rankings"
        className="flex items-center gap-4 rounded-[18px] bg-brand p-5 text-white"
        data-testid="tile-rankings"
      >
        <Trophy size={28} aria-hidden />
        <span className="flex-1">
          <span className="block text-[18px] font-bold">จัดอันดับ</span>
          <span className="block text-[14px] opacity-90">อันดับ 1–3 ของทุกชั้นเรียน</span>
        </span>
        <ChevronRight aria-hidden />
      </Link>

      <nav aria-label="เมนู" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {tiles.map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4 font-semibold hover:bg-surface-muted"
          >
            <Icon size={22} aria-hidden className="text-brand" />
            {label}
          </Link>
        ))}
      </nav>

      {rankings.groups.length > 0 ? (
        <section aria-label="อันดับ 1–3" className="hidden lg:block">
          <h2 className="mb-3 text-[19px] font-bold">อันดับ 1–3 สะสมทั้งเทอม</h2>
          <div className="grid grid-cols-4 gap-3">
            {rankings.groups.map((g) => (
              <RankCard key={g.group} group={g.group} rows={g.rows} all={false} />
            ))}
          </div>
        </section>
      ) : null}

      {guide.length > 0 ? (
        <section aria-label="วิธีการใช้งาน" className="rounded-[18px] border border-line bg-surface">
          {guide.slice(0, 5).map((g) => (
            <Link
              key={g.slug}
              href={`/guide/${g.slug}`}
              className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
            >
              {g.title}
              <ChevronRight size={18} aria-hidden />
            </Link>
          ))}
        </section>
      ) : null}
    </main>
  );
}
