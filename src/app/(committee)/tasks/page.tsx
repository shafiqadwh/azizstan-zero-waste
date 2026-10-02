import type { Metadata } from 'next';
import Link from 'next/link';
import { DeadlineBanner } from '@/components/app/DeadlineBanner';
import { InstallPrompt } from '@/components/app/InstallPrompt';
import { PushControls } from '@/components/app/PushControls';
import { formatTermLabel } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { listMyRequests } from '@/server/services/request.service';
import { getMyTasks } from '@/server/services/task.service';
import { MyRequests } from './MyRequests';
import { TaskList } from './TaskList';

export const metadata: Metadata = { title: 'งานของฉัน · AZIZSTAN ZERO WASTE' };

const tabCls = (on: boolean) =>
  `flex h-10 flex-1 items-center justify-center rounded-[10px] text-[14px] ${on ? 'bg-surface font-semibold shadow-sm' : ''}`;

/**
 * 08-ux-ui §6.7: deadline banner · search by room number · status tabs · target rows; §6.19 the
 * "คำขอของฉัน" tab (`?view=requests`).
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; view?: string }>;
}) {
  const user = await requirePageUser('/tasks');
  const now = new Date();
  const sp = await searchParams;
  const [{ termLabel, round, items }, requests] = await Promise.all([
    getMyTasks(getDb(), user, now),
    listMyRequests(getDb(), user, now),
  ]);
  const saved = sp.saved === '1' || sp.saved === 'auto';
  const view = sp.view === 'requests' ? 'requests' : 'tasks';
  const waiting = requests.filter((r) => r.status === 'waiting').length;
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
      <div>
        <h1 className="text-[20px] leading-[1.3] font-bold">งานของฉัน</h1>
        {termLabel ? (
          <p className="text-[14px] text-ink-muted">{formatTermLabel(termLabel.termNo, termLabel.academicYear)}</p>
        ) : null}
      </div>
      <InstallPrompt />
      {process.env.VAPID_PUBLIC_KEY ? <PushControls vapidKey={process.env.VAPID_PUBLIC_KEY} /> : null}
      <nav aria-label="มุมมอง" className="flex rounded-[14px] bg-[#E9E7DF] p-1">
        <Link href="/tasks" aria-current={view === 'tasks' ? 'page' : undefined} className={tabCls(view === 'tasks')}>
          งานประเมิน
        </Link>
        <Link
          href="/tasks?view=requests"
          aria-current={view === 'requests' ? 'page' : undefined}
          className={tabCls(view === 'requests')}
        >
          คำขอของฉัน{waiting ? ` ${waiting}` : ''}
        </Link>
        <Link href="/monitor" className={tabCls(false)}>
          ติดตามสถานะ
        </Link>
      </nav>
      {view === 'requests' ? <MyRequests requests={requests} /> : null}
      {view === 'tasks' && saved ? (
        <p role="status" className="rounded-lg bg-brand-soft px-4 py-3 text-[14px] font-semibold text-brand-ink">
          {sp.saved === 'auto' ? 'บันทึกแล้ว อนุมัติอัตโนมัติ' : 'ส่งแล้ว รออนุมัติ'}
        </p>
      ) : null}
      {view === 'tasks' && round ? <DeadlineBanner round={round} now={now} /> : null}
      {view === 'requests' ? null : items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center">
          {round ? 'คุณยังไม่ได้รับมอบหมายให้ประเมินในเทอมนี้' : 'ยังไม่มีรอบการประเมินในภาคเรียนนี้'}
        </p>
      ) : (
        <TaskList items={items} />
      )}
    </main>
  );
}
