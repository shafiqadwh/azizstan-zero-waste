import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { getRoomHub } from '@/server/services/room-hub.service';
import { RoomHeader } from './RoomHeader';

export const metadata: Metadata = { title: 'ห้องนี้ · AZIZSTAN ZERO WASTE' };

/**
 * Room hub (door QR, `/r/{qrToken}`): anyone who scans sees the room and a menu of the room's programs. Each
 * program lives on its own page; IT and facility reporting get their menu entries once they are built.
 */
export default async function RoomHubPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const hub = await getRoomHub(getDb(), qrToken, await getCurrentUser(), new Date());
  if (!hub) notFound();

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
      <RoomHeader hub={hub} />
      <nav aria-label="เมนูของห้องนี้" className="flex flex-col gap-3">
        <Link
          href={`/r/${qrToken}/cleanliness`}
          className="flex min-h-16 items-center gap-3 rounded-[18px] border border-line bg-surface px-4 py-3 text-[17px] font-bold"
          data-testid="menu-cleanliness"
        >
          <ClipboardCheck size={24} aria-hidden className="text-brand-ink" />
          <span className="flex-1">ประเมินความสะอาด</span>
          <ChevronRight size={20} aria-hidden className="text-ink-muted" />
        </Link>
      </nav>
    </main>
  );
}
