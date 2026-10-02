import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, ChevronRight, ClipboardCheck, LogIn, Monitor, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { publicClassScores } from '@/server/public-cache';
import { getRoomHub } from '@/server/services/room-hub.service';

export const metadata: Metadata = { title: 'ห้องนี้ · AZIZSTAN ZERO WASTE' };

function Service({
  icon,
  title,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4" data-testid={testId}>
      <h2 className="flex items-center gap-2 text-[17px] font-bold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

const primary =
  'flex min-h-12 items-center justify-center gap-2 rounded-[12px] bg-brand px-4 text-[16px] font-semibold text-white';

/**
 * Room hub (door QR, `/r/{qrToken}`): anyone who scans sees the room, the class in it and the services for the
 * room. Committee members get their evaluation button; IT and facility reporting share the same QR later.
 */
export default async function RoomHubPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const user = await getCurrentUser();
  const hub = await getRoomHub(getDb(), qrToken, user, new Date());
  if (!hub) notFound();
  const scores = hub.classId ? await publicClassScores(hub.classId) : null;
  const latest = scores?.rounds.filter((r) => r.total !== null).at(-1) ?? null;
  const place = [hub.building, hub.floor != null ? `ชั้น ${hub.floor}` : null].filter(Boolean).join(' ');

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
      <header className="rounded-[18px] bg-brand px-5 py-5 text-white" data-testid="room-hub-header">
        <p className="text-[14px] opacity-90">ห้อง</p>
        <h1 className="text-[40px] leading-tight font-bold">{hub.roomNumber}</h1>
        {hub.classLabel ? <p className="text-[18px] font-semibold">{hub.classLabel}</p> : null}
        {place ? <p className="text-[14px] opacity-90">{place}</p> : null}
      </header>

      <Service icon={<ClipboardCheck size={22} aria-hidden />} title="ประเมินความสะอาด" testId="service-cleanliness">
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
            href={`/login?next=${encodeURIComponent(`/r/${qrToken}`)}`}
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
      </Service>

      <Service icon={<Monitor size={22} aria-hidden />} title="แจ้งปัญหาไอที" testId="service-it">
        <p className="flex items-center gap-2 text-[15px] text-ink-muted">
          <Wrench size={16} aria-hidden />
          เปิดให้บริการเร็ว ๆ นี้
        </p>
      </Service>

      <Service icon={<Building2 size={22} aria-hidden />} title="แจ้งปัญหาอาคารสถานที่" testId="service-facility">
        <p className="flex items-center gap-2 text-[15px] text-ink-muted">
          <Wrench size={16} aria-hidden />
          เปิดให้บริการเร็ว ๆ นี้
        </p>
      </Service>
    </main>
  );
}
