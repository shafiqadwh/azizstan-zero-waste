'use client';

import { WifiOff } from 'lucide-react';
import { useEffect } from 'react';
import { purgeExpiredDrafts } from '@/lib/offline/draft-store';
import { useOnline } from '@/lib/offline/use-online';

/** 08-ux-ui §7 "Offline" state, committee pages only. Also clears drafts older than 7 days (07-frontend §3.5). */
export function OfflineBanner() {
  const online = useOnline();
  useEffect(() => {
    void purgeExpiredDrafts(Date.now());
  }, []);
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-20 flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 text-[14px] font-semibold text-warn-ink"
    >
      <WifiOff size={18} aria-hidden />
      ออฟไลน์ — ข้อมูลจะถูกส่งเมื่อมีสัญญาณ
    </div>
  );
}
