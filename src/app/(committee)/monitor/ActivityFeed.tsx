'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatThaiTime } from '@/lib/dates';

interface Item {
  id: number;
  at: string;
  text: string;
  href: string | null;
}

/** "ความเคลื่อนไหวล่าสุด" (11-jobs §2b): the latest 50 events of the round, polled every 30 s. */
export function ActivityFeed({ roundId }: { roundId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await fetch(`/api/v1/monitor/activity?round=${roundId}`, { cache: 'no-store' });
      if (res.ok && alive) setItems(await res.json());
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [roundId]);
  return (
    <section aria-labelledby="feed-title" className="rounded-[18px] border border-line bg-surface p-4">
      <h2 id="feed-title" className="mb-3 text-[17px] font-bold">
        ความเคลื่อนไหวล่าสุด
      </h2>
      {items === null ? (
        <p className="text-[14px] text-ink-muted">กำลังโหลด…</p>
      ) : items.length === 0 ? (
        <p className="text-[14px] text-ink-muted">ยังไม่มีความเคลื่อนไหวในรอบนี้</p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="activity">
          {items.map((i) => (
            <li key={i.id} className="text-[14px]">
              <span className="mr-2 text-[13px] text-ink-muted">{formatThaiTime(new Date(i.at))}</span>
              {i.href ? (
                <Link href={i.href} className="underline">
                  {i.text}
                </Link>
              ) : (
                i.text
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
