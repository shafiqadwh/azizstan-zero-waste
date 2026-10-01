'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** T23: re-render the server page every `seconds` (30 s on the dashboard and approvals) while the tab is visible. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
