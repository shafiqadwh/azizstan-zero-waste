'use client';

import { useRouter } from 'next/navigation';
import { openNotificationAction } from './actions';

/** A notification row: tapping marks it read and opens its link. */
export function InboxItem({
  id,
  link,
  read,
  children,
}: {
  id: string;
  link: string | null;
  read: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        if (!read) await openNotificationAction(id);
        if (link?.startsWith('/')) router.push(link);
        else router.refresh();
      }}
      className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-surface-muted ${read ? '' : 'bg-brand-soft/40'}`}
    >
      {children}
    </button>
  );
}
