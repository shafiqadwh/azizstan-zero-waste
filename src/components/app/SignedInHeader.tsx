import { Bell, CircleHelp } from 'lucide-react';
import Link from 'next/link';
import { getDb } from '@/server/db';
import type { SessionUser } from '@/server/policies';
import { unreadCount } from '@/server/services/push.service';
import { Logo } from './Logo';
import { LogoutButton } from './LogoutButton';

const ROLE_LABEL: Record<SessionUser['role'], string> = {
  super_admin: 'ผู้ดูแลระบบสูงสุด',
  admin: 'แอดมิน',
  executive: 'ผู้บริหาร',
  teacher: 'ครู',
};

/** Top bar for signed-in pages: wordmark, inbox bell with the unread count, user, logout. */
export async function SignedInHeader({ user }: { user: SessionUser }) {
  const unread = await unreadCount(getDb(), user);
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3 lg:px-12">
      <span className="text-[17px]">
        <Logo />
      </span>
      <div className="flex items-center gap-3">
        <Link
          href="/help"
          aria-label="คู่มือ"
          title="คู่มือ"
          className="flex size-11 items-center justify-center rounded-md border border-line-strong hover:bg-surface-muted"
        >
          <CircleHelp size={20} aria-hidden />
        </Link>
        <Link
          href="/inbox"
          aria-label={unread ? `การแจ้งเตือน ยังไม่อ่าน ${unread} รายการ` : 'การแจ้งเตือน'}
          className="relative flex size-11 items-center justify-center rounded-md border border-line-strong hover:bg-surface-muted"
        >
          <Bell size={20} aria-hidden />
          {unread ? (
            <span
              data-testid="unread-badge"
              className="absolute -top-1 -right-1 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] leading-5 font-bold text-white"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Link>
        <span className="hidden text-right text-[13px] leading-tight text-ink-muted md:block">
          <span className="block font-semibold text-ink">{user.displayName}</span>
          {ROLE_LABEL[user.role]}
        </span>
        <LogoutButton userId={user.id} />
      </div>
    </header>
  );
}
