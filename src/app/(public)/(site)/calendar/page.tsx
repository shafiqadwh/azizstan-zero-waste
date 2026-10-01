import { CalendarPlus } from 'lucide-react';
import type { Metadata } from 'next';
import { calendarMonths, spanDays, THAI_WEEKDAYS_SHORT, type CalendarRound } from '@/lib/calendar';
import { formatTermLabel, formatThaiDateTime } from '@/lib/dates';
import { publicSummary } from '@/server/public-cache';

export const metadata: Metadata = { title: 'ปฏิทินการประเมิน · AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

const STATUS: Record<CalendarRound['status'], { text: string; cls: string }> = {
  scheduled: { text: 'ยังไม่เปิด', cls: 'bg-surface-muted text-ink' },
  open: { text: 'เปิดลงคะแนน', cls: 'bg-brand text-white' },
  closed: { text: 'ปิดรับคะแนนแล้ว · กำลังสรุปผล', cls: 'bg-warn-soft text-warn-ink' },
  finalized: { text: 'ปิดรอบแล้ว', cls: 'bg-brand-soft text-brand-ink' },
};

/** FR-W6 / T31: the term's rounds as a list and as month grids; one tap adds them to the phone's calendar. */
export default async function CalendarPage() {
  const summary = await publicSummary();
  const now = new Date();
  const rounds = summary.rounds;
  const months = calendarMonths(rounds, now);

  return (
    <main className="mx-auto flex max-w-[960px] flex-col gap-5 px-5 py-6 lg:py-8">
      <div>
        <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ปฏิทินการประเมิน</h1>
        {summary.term ? (
          <p className="mt-1 text-[14px] text-ink-muted">
            {formatTermLabel(summary.term.termNo, summary.term.academicYear)} · {rounds.length} รอบ
          </p>
        ) : null}
      </div>

      {!summary.term || rounds.length === 0 ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">ยังไม่มีกำหนดการประเมินในภาคเรียนนี้</p>
      ) : (
        <>
          <ol className="grid gap-3 md:grid-cols-2" aria-label="รอบการประเมิน" data-testid="calendar-rounds">
            {rounds.map((r) => (
              <li key={r.roundNo} className="rounded-[18px] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[17px] font-bold">รอบที่ {r.roundNo}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${STATUS[r.status].cls}`}>
                    {STATUS[r.status].text}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
                  <dt className="text-ink-muted">เปิดลงคะแนน</dt>
                  <dd>{formatThaiDateTime(new Date(r.opensAt))}</dd>
                  <dt className="text-ink-muted">ปิดรับคะแนน</dt>
                  <dd className="font-semibold">{formatThaiDateTime(new Date(r.closesAt))}</dd>
                  <dt className="text-ink-muted">ระยะเวลา</dt>
                  <dd>{spanDays(r.opensAt, r.closesAt)} วัน</dd>
                </dl>
              </li>
            ))}
          </ol>

          <a
            href="/calendar.ics"
            className="inline-flex h-12 items-center gap-2 self-start rounded-md border border-line-strong bg-surface px-4 font-semibold hover:bg-surface-muted"
          >
            <CalendarPlus size={20} aria-hidden className="text-brand" />
            เพิ่มลงปฏิทินในมือถือ (.ics)
          </a>

          <div className="grid gap-4 md:grid-cols-2">
            {months.map((m) => (
              <section
                key={m.key}
                aria-label={m.label}
                data-testid={`month-${m.key}`}
                className="rounded-[18px] border border-line bg-surface p-4"
              >
                <h2 className="mb-2 text-[16px] font-bold">{m.label}</h2>
                <table className="w-full table-fixed text-center text-[14px]">
                  <thead>
                    <tr>
                      {THAI_WEEKDAYS_SHORT.map((d) => (
                        <th key={d} scope="col" className="pb-1 text-[12px] font-medium text-ink-muted">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.weeks.map((w, i) => (
                      <tr key={i}>
                        {w.map((d, j) =>
                          d ? (
                            <td key={j} className="p-0.5">
                              <span
                                data-date={d.date}
                                data-rounds={d.rounds.join(' ')}
                                title={d.rounds.length ? d.rounds.map((n) => `รอบที่ ${n}`).join(', ') : undefined}
                                className={[
                                  'flex h-9 flex-col items-center justify-center rounded-md leading-none',
                                  d.rounds.length ? 'bg-brand-soft font-semibold text-brand-ink' : '',
                                  d.closes.length ? 'ring-2 ring-brand ring-inset' : '',
                                  d.today ? 'outline-2 outline-offset-1 outline-ink' : '',
                                ].join(' ')}
                              >
                                {d.day}
                                {d.rounds.length ? (
                                  <span className="mt-0.5 text-[10px] font-medium">ร.{d.rounds.join(',')}</span>
                                ) : null}
                                {d.rounds.length ? (
                                  <span className="sr-only">
                                    {d.opens.length ? ` เปิดรอบที่ ${d.opens.join(', ')}` : ''}
                                    {d.closes.length ? ` ปิดรับคะแนนรอบที่ ${d.closes.join(', ')}` : ''}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                          ) : (
                            <td key={j} />
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-4 rounded bg-brand-soft" aria-hidden /> วันที่เปิดลงคะแนน
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-4 rounded bg-brand-soft ring-2 ring-brand ring-inset" aria-hidden />{' '}
              วันปิดรับคะแนน
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-4 rounded outline-2 outline-offset-1 outline-ink" aria-hidden /> วันนี้
            </span>
          </p>
        </>
      )}
    </main>
  );
}
