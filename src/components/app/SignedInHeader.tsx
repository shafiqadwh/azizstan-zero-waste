import { LogOut } from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';
import type { SessionUser } from '@/server/policies';
import { Logo } from './Logo';

const ROLE_LABEL: Record<SessionUser['role'], string> = {
  super_admin: 'ผู้ดูแลระบบสูงสุด',
  admin: 'แอดมิน',
  executive: 'ผู้บริหาร',
  teacher: 'ครู',
};

/** Minimal top bar until the real admin/committee shells land (T11+). */
export function SignedInHeader({ user }: { user: SessionUser }) {
  return (
    <header className="border-line bg-surface flex items-center justify-between gap-3 border-b px-5 py-3 lg:px-12">
      <span className="text-[17px]">
        <Logo />
      </span>
      <div className="flex items-center gap-3">
        <span className="text-ink-muted hidden text-right text-[13px] leading-tight sm:block">
          <span className="text-ink block font-semibold">{user.displayName}</span>
          {ROLE_LABEL[user.role]}
        </span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="border-line-strong text-ink hover:bg-surface-muted flex h-11 items-center gap-2 rounded-md border px-3 text-[14px] font-medium"
          >
            <LogOut size={18} aria-hidden />
            ออกจากระบบ
          </button>
        </form>
      </div>
    </header>
  );
}
