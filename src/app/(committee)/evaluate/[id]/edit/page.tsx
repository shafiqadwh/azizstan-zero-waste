import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { parseScore } from '@/lib/scoring/decimal';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import type { SessionUser } from '@/server/policies';
import { AppError } from '@/server/errors';
import { getEvaluationDetail, getEvaluationForm } from '@/server/services/task.service';
import { EvaluationForm } from '../../EvaluationForm';

export const metadata: Metadata = { title: 'แก้ไขผลประเมิน · AZIZSTAN ZERO WASTE' };

async function load(user: SessionUser, id: string, now: Date) {
  const db = getDb();
  try {
    const d = await getEvaluationDetail(db, user, id, now);
    if (!d.canEdit || (d.status !== 'submitted' && d.status !== 'returned')) return { d, ctx: null };
    const ctx = await getEvaluationForm(
      db,
      user,
      { roundId: d.roundId, componentId: d.componentId, target: d.target },
      now,
    );
    return { d: { ...d, status: d.status }, ctx };
  } catch (err) {
    if (err instanceof AppError && (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN')) return null;
    throw err;
  }
}

/** BR-E2 / BR-E8: the owner's own edit (or fix after "ส่งกลับ") inside the self-edit window. */
export default async function EditEvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/evaluate/${id}/edit`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const loaded = await load(user, id, new Date());
  if (!loaded) notFound();
  const { d, ctx } = loaded;
  if (!ctx || (d.status !== 'submitted' && d.status !== 'returned')) redirect(`/evaluate/${id}`);
  const signature = d.photos.find((p) => p.kind === 'signature');
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-4">
      <div className="flex items-center gap-2">
        <Link
          href={`/evaluate/${id}`}
          aria-label="กลับ"
          className="flex size-11 items-center justify-center rounded-md"
        >
          <ChevronLeft size={24} aria-hidden />
        </Link>
        <h1 className="text-[18px] font-bold">แก้ไขผลประเมิน</h1>
      </div>
      {d.returnedReason ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-[14px] text-danger-ink">
          ส่งกลับให้แก้: {d.returnedReason}
        </p>
      ) : null}
      <EvaluationForm
        ctx={ctx}
        initial={{
          evaluationId: d.id,
          version: d.version,
          status: d.status,
          // individual mode: d.score is the class mean, not something the owner entered
          score: ctx.individual || d.score === null ? null : parseScore(d.score),
          studentScores: Object.fromEntries(d.studentScores.map((r) => [r.studentId, r.score])),
          site: d.photos.filter((p) => p.kind === 'site').map((p) => ({ evidenceId: p.id, src: p.thumb })),
          signature: signature ? { evidenceId: signature.id, src: signature.thumb } : null,
          comment: d.comment ?? '',
        }}
      />
    </main>
  );
}
