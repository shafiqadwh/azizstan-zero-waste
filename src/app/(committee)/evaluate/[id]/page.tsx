import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { StatusPill } from '@/components/app/StatusPill';
import { TargetHeader } from '@/components/app/TargetHeader';
import { formatThaiDateTime } from '@/lib/dates';
import { parseScore, toDisplay } from '@/lib/scoring/decimal';
import { trimScore } from '@/lib/term/config';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError } from '@/server/errors';
import { getEvaluationDetail, type EvaluationDetail } from '@/server/services/task.service';
import { DeleteEvaluation } from './DeleteEvaluation';
import { RequestSheet } from './RequestSheet';

export const metadata: Metadata = { title: 'ผลประเมิน · AZIZSTAN ZERO WASTE' };

const REQUEST_STATUS = {
  waiting: 'รอพิจารณาคำขอ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ถูกปฏิเสธ',
  cancelled: 'ยกเลิกแล้ว',
  expired: 'หมดอายุ',
} as const;

const ACTION_LABEL: Record<string, string> = {
  'evaluation.submit': 'ส่งผลประเมิน',
  'evaluation.update': 'แก้ไข',
  'evaluation.resubmit': 'แก้แล้วส่งใหม่',
  'evaluation.return': 'ส่งกลับให้แก้',
  'evaluation.approve': 'อนุมัติ',
  'evaluation.delete': 'ลบผลประเมิน',
};

/** "21 ชม. 14 นาที" */
function remaining(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
}

/** 08-ux-ui §6.9: score, photos, comment, status timeline; owner within the window may edit or delete. */
export default async function EvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/evaluate/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const now = new Date();
  let d: EvaluationDetail;
  try {
    d = await getEvaluationDetail(getDb(), user, id, now);
  } catch (err) {
    if (err instanceof AppError && (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN')) notFound();
    throw err;
  }
  const show = (s: string) => trimScore(toDisplay(parseScore(s)));
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-4">
      <div className="flex items-center gap-2">
        <Link href="/tasks" aria-label="กลับ" className="flex size-11 items-center justify-center rounded-md">
          <ChevronLeft size={24} aria-hidden />
        </Link>
        <h1 className="flex-1 text-[18px] font-bold">ผลประเมิน</h1>
        <StatusPill status={d.status} />
      </div>
      <TargetHeader
        roomNumber={d.target.roomNumber}
        label={d.target.label}
        subtitle={d.target.subtitle}
        roundNo={d.roundNo}
      />

      {d.returnedReason ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-[14px] text-danger-ink">
          ส่งกลับให้แก้: {d.returnedReason}
        </p>
      ) : null}

      <section className="rounded-[18px] border border-line bg-surface p-4">
        <h2 className="text-[16px] font-bold">{d.componentLabel}</h2>
        <p className="mt-1 text-[40px] leading-tight font-bold" data-testid="detail-score">
          {d.score === null ? '–' : show(d.score)}
          <span className="text-[17px] font-normal text-ink-muted"> / {trimScore(toDisplay(d.max))}</span>
        </p>
        <p className="text-[14px] text-ink-muted">ประเมินโดย {d.ownerName}</p>
      </section>

      {d.photos.length > 0 ? (
        <section className="rounded-[18px] border border-line bg-surface p-4">
          <h2 className="mb-3 text-[16px] font-bold">รูปภาพ</h2>
          <ul className="grid grid-cols-3 gap-2">
            {d.photos.map((p, i) => (
              <li key={p.id} className="relative">
                <a href={p.full} target="_blank" rel="noreferrer" aria-label={`ดูรูปที่ ${i + 1} ขนาดเต็ม`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API image */}
                  <img src={p.thumb} alt="" className="aspect-square w-full rounded-[14px] object-cover" />
                </a>
                {p.kind === 'signature' ? (
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-[12px] text-white">
                    ใบลงชื่อ
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.comment ? (
        <section className="rounded-[18px] border border-line bg-surface p-4">
          <h2 className="mb-1 text-[16px] font-bold">คำแนะนำและข้อติชม</h2>
          <p className="text-[15px] whitespace-pre-wrap">{d.comment}</p>
        </section>
      ) : null}

      <section className="rounded-[18px] border border-line bg-surface p-4">
        <h2 className="mb-2 text-[16px] font-bold">ลำดับเหตุการณ์</h2>
        <ol className="flex flex-col gap-1 text-[14px]">
          {d.history.map((h, i) => (
            <li key={i}>
              {ACTION_LABEL[h.action] ?? h.action} · {h.actorName ?? 'ระบบ'} · {formatThaiDateTime(h.at)}
            </li>
          ))}
        </ol>
      </section>

      {d.canEdit ? (
        <section className="flex flex-col gap-2">
          <p className="text-[14px] text-ink-muted">
            แก้ไขเองได้อีก {remaining(d.selfEditUntil.getTime() - now.getTime())}
          </p>
          <div className="flex gap-2">
            <Link
              href={`/evaluate/${d.id}/edit`}
              className="flex h-12 flex-1 items-center justify-center rounded-[12px] bg-brand font-semibold text-white"
            >
              {d.status === 'returned' ? 'แก้ไขแล้วส่งใหม่' : 'แก้ไข'}
            </Link>
            <DeleteEvaluation id={d.id} version={d.version} />
          </div>
        </section>
      ) : d.canRequest ? (
        <RequestSheet
          evaluationId={d.id}
          target={`${d.target.type}:${d.target.id}`}
          isOwner={d.isOwner}
          score={d.score === null ? null : parseScore(d.score)}
          max={d.max}
          step={d.step}
          comment={d.comment ?? ''}
          photos={d.photos}
          photoMax={d.photoMax}
          moveOptions={d.moveOptions}
        />
      ) : null}

      {d.requests.length > 0 ? (
        <section className="rounded-[18px] border border-line bg-surface p-4">
          <h2 className="mb-2 text-[16px] font-bold">คำขออนุมัติ</h2>
          <ul className="flex flex-col gap-2 text-[14px]">
            {d.requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 border-b border-line pb-2 last:border-0">
                <span className="font-semibold">
                  {r.typeLabel} · {REQUEST_STATUS[r.status]}
                </span>
                <span>
                  {r.oldValue !== null ? (
                    <>
                      <s className="text-ink-muted">{r.oldValue}</s> → <b>{r.newValue}</b>
                    </>
                  ) : (
                    r.newValue
                  )}
                </span>
                <span className="text-ink-muted">
                  {r.requesterName} · {formatThaiDateTime(r.createdAt)} · {r.reason}
                </span>
                {r.decisionNote ? <span className="text-ink-muted">หมายเหตุ: {r.decisionNote}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
