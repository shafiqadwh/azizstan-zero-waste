import type { Metadata } from 'next';
import { DeadlineBanner } from '@/components/app/DeadlineBanner';
import { formatTermLabel } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { getMyTasks } from '@/server/services/task.service';
import { TaskList } from './TaskList';

export const metadata: Metadata = { title: 'งานของฉัน · AZIZSTAN ZERO WASTE' };

/** 08-ux-ui §6.7: deadline banner · search by room number · status tabs · target rows. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requirePageUser('/tasks');
  const now = new Date();
  const { termLabel, round, items } = await getMyTasks(getDb(), user, now);
  const saved = (await searchParams).saved === '1';
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
      <div>
        <h1 className="text-[20px] leading-[1.3] font-bold">งานของฉัน</h1>
        {termLabel ? (
          <p className="text-[14px] text-ink-muted">{formatTermLabel(termLabel.termNo, termLabel.academicYear)}</p>
        ) : null}
      </div>
      {saved ? (
        <p role="status" className="rounded-lg bg-brand-soft px-4 py-3 text-[14px] font-semibold text-brand-ink">
          ส่งแล้ว รออนุมัติ
        </p>
      ) : null}
      {round ? <DeadlineBanner round={round} now={now} /> : null}
      {items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center">
          {round ? 'คุณยังไม่ได้รับมอบหมายให้ประเมินในเทอมนี้' : 'ยังไม่มีรอบการประเมินในภาคเรียนนี้'}
        </p>
      ) : (
        <TaskList items={items} />
      )}
    </main>
  );
}
