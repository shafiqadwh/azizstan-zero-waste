import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { hrefForRoomQr } from '@/server/services/task.service';

export const metadata: Metadata = { title: 'สแกน QR ห้อง · AZIZSTAN ZERO WASTE' };

/** Door QR (07-frontend §3.1): the phone's own camera opens this URL; we send the user to that room's task. */
export default async function RoomQrPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const user = await requirePageUser(`/r/${qrToken}`);
  const href = await hrefForRoomQr(getDb(), user, qrToken, new Date());
  if (href) redirect(href);
  return (
    <main className="mx-auto max-w-[720px] px-5 py-8">
      <p role="alert" className="rounded-lg bg-warn-soft px-4 py-4 text-warn-ink">
        ห้องนี้ไม่อยู่ในรายการที่คุณต้องประเมินในรอบนี้
      </p>
      <a href="/tasks" className="mt-4 inline-block text-brand-ink underline">
        กลับไปงานของฉัน
      </a>
    </main>
  );
}
