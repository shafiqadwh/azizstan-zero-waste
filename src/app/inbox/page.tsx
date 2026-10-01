import type { Metadata } from 'next';
import { InstallPrompt } from '@/components/app/InstallPrompt';
import { PushControls } from '@/components/app/PushControls';
import { SignedInHeader } from '@/components/app/SignedInHeader';
import { formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { getInbox } from '@/server/services/push.service';
import { markAllReadAction } from './actions';
import { InboxItem } from './InboxItem';

export const metadata: Metadata = { title: 'การแจ้งเตือน · AZIZSTAN ZERO WASTE' };

/** In-app inbox (11-jobs §2): the source of truth for every notification; push is only a copy. */
export default async function InboxPage() {
  const user = await requirePageUser('/inbox');
  const inbox = await getInbox(getDb(), user);
  const vapid = process.env.VAPID_PUBLIC_KEY ?? '';
  return (
    <>
      <SignedInHeader user={user} />
      <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[20px] leading-[1.3] font-bold">การแจ้งเตือน</h1>
          {inbox.unread > 0 ? (
            <form action={markAllReadAction}>
              <button type="submit" className="text-[14px] font-semibold text-brand-ink underline">
                อ่านทั้งหมดแล้ว
              </button>
            </form>
          ) : null}
        </div>
        <InstallPrompt />
        {vapid ? <PushControls vapidKey={vapid} /> : null}
        {inbox.items.length === 0 ? (
          <p className="rounded-[18px] border border-line bg-surface px-5 py-6 text-center">ยังไม่มีการแจ้งเตือน</p>
        ) : (
          <ul className="overflow-hidden rounded-[18px] border border-line bg-surface" data-testid="inbox">
            {inbox.items.map((n) => (
              <li key={n.id} className="border-b border-line last:border-b-0">
                <InboxItem id={n.id} link={n.link} read={n.read}>
                  <span className={`text-[15px] ${n.read ? '' : 'font-semibold'}`}>
                    {n.read ? null : <span className="sr-only">ยังไม่อ่าน · </span>}
                    {n.title}
                  </span>
                  <span className="text-[14px] text-ink-muted">{n.body}</span>
                  <span className="text-[12px] text-ink-muted">{formatThaiDateTime(n.createdAt)}</span>
                </InboxItem>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
