import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, ClipboardCheck, LogIn } from 'lucide-react';
import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { publicClassScores } from '@/server/public-cache';
import { getRoomHub } from '@/server/services/room-hub.service';
import { RoomHeader } from '../RoomHeader';

export const metadata: Metadata = { title: 'ประเมินความสะอาด · AZIZSTAN ZERO WASTE' };

const primary =
  'flex min-h-12 items-center justify-center gap-2 rounded-[12px] bg-brand px-4 text-[16px] font-semibold text-white';

/** Cleanliness program of the room hub: the class's scores and the viewer's evaluation action. */
export default async function RoomCleanlinessPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const hub = await getRoomHub(getDb(), qrToken, await getCurrentUser(), new Date());
  if (!hub) notFound();
  const scores = hub.classId ? await publicClassScores(hub.classId) : null;
  const latest = scores?.rounds.filter((r) => r.total !== null).at(-1) ?? null;

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
      <Link href={`/r/${qrToken}`} className="flex items-center gap-1 text-[15px] text-brand-ink">
        <ChevronLeft size={18} aria-hidden />
        เมนูของห้อง
      </Link>
      <RoomHeader hub={hub} />

      <section
        className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4"
        data-testid="service-cleanliness"
      >
        <h2 className="flex items-center gap-2 text-[17px] font-bold">
          <ClipboardCheck size={22} aria-hidden />
          ประเมินความสะอาด
        </h2>
        {hub.classId ? (
          <dl className="grid grid-cols-2 gap-2 text-[15px]">
            <div className="rounded-md bg-surface-muted px-3 py-2">
              <dt className="text-[13px] text-ink-muted">
                {latest ? `คะแนนรอบที่ ${latest.roundNo}` : 'คะแนนรอบล่าสุด'}
              </dt>
              <dd className="text-[22px] font-bold">{latest?.total ?? 'รอผล'}</dd>
            </div>
            <div className="rounded-md bg-surface-muted px-3 py-2">
              <dt className="text-[13px] text-ink-muted">คะแนนภาคเรียน</dt>
              <dd className="text-[22px] font-bold">{scores?.termScore ?? '–'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-[15px] text-ink-muted">ห้องนี้ยังไม่มีห้องเรียนที่ร่วมประเมินในภาคเรียนนี้</p>
        )}
        {hub.evaluation.kind === 'evaluate' ? (
          <Link href={hub.evaluation.href} className={primary}>
            ประเมินห้องนี้
            <ChevronRight size={18} aria-hidden />
          </Link>
        ) : hub.evaluation.kind === 'view' ? (
          <Link href={hub.evaluation.href} className={primary}>
            ดูผลประเมินของห้องนี้
            <ChevronRight size={18} aria-hidden />
          </Link>
        ) : hub.evaluation.kind === 'login' ? (
          <Link
            href={`/login?next=${encodeURIComponent(`/r/${qrToken}/cleanliness`)}`}
            className="flex min-h-12 items-center justify-center gap-2 rounded-[12px] border border-line-strong px-4 text-[15px] font-semibold"
          >
            <LogIn size={18} aria-hidden />
            กรรมการ: เข้าสู่ระบบเพื่อประเมิน
          </Link>
        ) : (
          <p className="text-[14px] text-ink-muted">ห้องนี้ไม่อยู่ในรายการที่คุณต้องประเมินในรอบนี้</p>
        )}
        {hub.classId ? (
          <Link href={`/classes?class=${hub.classId}`} className="text-[14px] text-brand-ink underline">
            ดูคะแนนทุกรอบของห้องนี้
          </Link>
        ) : null}
      </section>
    </main>
  );
}
