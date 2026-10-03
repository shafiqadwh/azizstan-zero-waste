'use client';

import { ChevronLeft, House } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * "ย้อนกลับ" row under the signed-in header. The installed app (PWA, display: standalone) has no browser back
 * button, so every page below the user's home needs its own way back. Back goes to the previous page when the app
 * navigated here itself, else to the home page (opened from a notification, a QR code or a bookmark).
 */
export function BackBar({ home }: { home: string }) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === home) return null;
  return (
    <nav aria-label="การนำทาง" className="border-b border-line bg-surface px-5 lg:px-12">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            const sameApp = document.referrer !== '' && new URL(document.referrer).origin === window.location.origin;
            if (sameApp && window.history.length > 1) router.back();
            else router.push(home);
          }}
          className="-ml-2 flex min-h-11 items-center gap-1 rounded-md px-2 text-[15px] font-medium text-brand-ink hover:bg-surface-muted"
        >
          <ChevronLeft size={20} aria-hidden />
          ย้อนกลับ
        </button>
        <Link
          href={home}
          className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[14px] text-ink-muted hover:bg-surface-muted"
        >
          <House size={18} aria-hidden />
          หน้าหลัก
        </Link>
      </div>
    </nav>
  );
}
