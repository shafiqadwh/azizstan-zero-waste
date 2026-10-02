'use client';

import { LogOut } from 'lucide-react';
import { useRef } from 'react';
import { logoutAction } from '@/app/actions/auth';
import { countDraftsOf, deleteDraftsOf } from '@/lib/offline/draft-store';

/**
 * Logout that first removes this user's offline drafts from the device (12-security §2 item 13): drafts hold
 * photos, signature sheets included, and a school phone is often shared. Unsent drafts are named before they go.
 */
export function LogoutButton({ userId }: { userId: string }) {
  const cleared = useRef(false);
  return (
    <form
      action={logoutAction}
      onSubmit={async (e) => {
        if (cleared.current) return;
        e.preventDefault();
        const form = e.currentTarget;
        const n = await countDraftsOf(userId);
        if (
          n > 0 &&
          !window.confirm(
            `มีแบบร่างที่ยังไม่ได้ส่ง ${n} รายการในเครื่องนี้ ระบบจะลบออกเมื่อออกจากระบบ\nออกจากระบบต่อหรือไม่?`,
          )
        )
          return;
        await deleteDraftsOf(userId);
        cleared.current = true;
        form.requestSubmit();
      }}
    >
      <button
        type="submit"
        aria-label="ออกจากระบบ"
        className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-line-strong px-3 text-[14px] font-medium whitespace-nowrap text-ink hover:bg-surface-muted"
      >
        <LogOut size={18} aria-hidden />
        {/* icon only on phones so the help and inbox buttons fit at 360 px */}
        <span className="hidden md:inline">ออกจากระบบ</span>
      </button>
    </form>
  );
}
