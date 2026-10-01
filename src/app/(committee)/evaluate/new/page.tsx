import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError } from '@/server/errors';
import { getEvaluationForm, type EvaluationForm as FormContext } from '@/server/services/task.service';
import { TargetHeader } from '@/components/app/TargetHeader';
import { EvaluationForm } from '../EvaluationForm';
import { LateEntryRequest } from './LateEntryRequest';

export const metadata: Metadata = { title: 'ประเมินห้องเรียน · AZIZSTAN ZERO WASTE' };

const UUID = /^[0-9a-f-]{36}$/i;

/** 08-ux-ui §6.8 `/evaluate/new?round=&component=&target=class:<id>|area:<id>` */
export default async function NewEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string; component?: string; target?: string }>;
}) {
  const sp = await searchParams;
  const user = await requirePageUser('/tasks');
  const [type, id] = (sp.target ?? '').split(':');
  if (!UUID.test(sp.round ?? '') || !UUID.test(sp.component ?? '') || !UUID.test(id ?? '')) notFound();
  if (type !== 'class' && type !== 'area') notFound();
  let ctx: FormContext;
  try {
    ctx = await getEvaluationForm(
      getDb(),
      user,
      { roundId: sp.round!, componentId: sp.component!, target: { type, id: id! } },
      new Date(),
    );
  } catch (err) {
    if (err instanceof AppError && err.code === 'FORBIDDEN') {
      return (
        <main className="mx-auto max-w-[720px] px-5 py-8">
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-4 text-danger-ink">
            คุณไม่ได้รับมอบหมายให้ประเมินห้องนี้
          </p>
        </main>
      );
    }
    if (err instanceof AppError && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  // BR-P3: already scored → show it instead of a second form
  if (ctx.existingId) redirect(`/evaluate/${ctx.existingId}`);

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-4">
      <div className="flex items-center gap-2">
        <Link href="/tasks" aria-label="กลับ" className="flex size-11 items-center justify-center rounded-md">
          <ChevronLeft size={24} aria-hidden />
        </Link>
        <h1 className="text-[18px] font-bold">{ctx.target.type === 'class' ? 'ประเมินห้องเรียน' : 'ประเมินพื้นที่'}</h1>
      </div>
      {ctx.individual ? (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-warn-ink">
          ภาคเรียนนี้ให้คะแนนรายบุคคล หน้านี้ยังรองรับเฉพาะการให้คะแนนทั้งห้อง
        </p>
      ) : ctx.canEnter ? (
        <EvaluationForm ctx={ctx} />
      ) : (
        <>
          <TargetHeader
            roomNumber={ctx.target.roomNumber}
            label={ctx.target.label}
            subtitle={ctx.target.subtitle}
            roundNo={ctx.round.roundNo}
          />
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-4 text-danger-ink">
            {ctx.round.status === 'scheduled' || ctx.round.status === 'finalized'
              ? ctx.round.status === 'scheduled'
                ? 'รอบนี้ยังไม่เปิดลงคะแนน'
                : 'รอบนี้ปิดรอบแล้ว'
              : 'เลยกำหนดใส่คะแนนแล้ว กด "ขออนุมัติใส่คะแนน"'}
          </p>
          {ctx.lateRequestWaiting ? (
            <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-warn-ink">
              รอพิจารณาคำขอ · ส่งคำขอใส่คะแนนแล้ว รอผู้ดูแลอนุมัติ
            </p>
          ) : ctx.canRequestLate ? (
            <LateEntryRequest
              roundId={ctx.round.id}
              componentId={ctx.componentId}
              target={{ type: ctx.target.type, id: ctx.target.id }}
              defaultHours={ctx.lateEntryDefaultHours}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
