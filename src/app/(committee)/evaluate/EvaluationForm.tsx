'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { PhotoGrid, type PhotoItem } from '@/components/app/PhotoGrid';
import { ScoreInput } from '@/components/app/ScoreInput';
import { TargetHeader } from '@/components/app/TargetHeader';
import { checkContent, type ContentError } from '@/lib/evaluation/validate';
import { toDisplay, toDb, type Th } from '@/lib/scoring/decimal';
import { trimScore } from '@/lib/term/config';
import type { EvaluationForm as FormContext } from '@/server/services/task.service';
import { submitEvaluationAction, updateEvaluationAction } from './actions';

type Field = ContentError['field'];

export interface InitialContent {
  evaluationId: string;
  version: number;
  status: 'submitted' | 'returned';
  score: Th | null;
  site: { evidenceId: string; src: string }[];
  signature: { evidenceId: string; src: string } | null;
  comment: string;
}

const show = (th: Th) => trimScore(toDisplay(th));

/** Phones send 12 MP photos; shrink to ≤ 2000 px JPEG 0.85 before upload (07-frontend §3.4). The server re-encodes. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    return blob ?? file;
  } catch {
    return file; // the server explains what is wrong with the file
  }
}

async function upload(blob: Blob, kind: 'site' | 'signature', target: string) {
  const fd = new FormData();
  fd.set('file', blob, 'photo.jpg');
  fd.set('kind', kind);
  fd.set('targetRef', target);
  const res = await fetch('/api/v1/uploads', { method: 'POST', body: fd });
  const body = (await res.json().catch(() => null)) as
    { evidenceId: string; url: string } | { error: { message: string } } | null;
  if (!res.ok || !body || 'error' in body) {
    throw new Error(body && 'error' in body ? body.error.message : 'อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
  return body;
}

function Card({
  title,
  aside,
  error,
  errorId,
  children,
}: {
  title: string;
  aside?: ReactNode;
  error?: string;
  errorId: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-line bg-surface p-4" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-bold">{title}</h2>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-[14px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** 08-ux-ui §6.8 — new evaluation, or the owner's edit / fix-and-resubmit of their own (BR-E2, BR-E8). */
export function EvaluationForm({ ctx, initial }: { ctx: FormContext; initial?: InitialContent }) {
  const router = useRouter();
  const target = `${ctx.target.type}:${ctx.target.id}`;
  const [score, setScore] = useState<Th | null>(initial?.score ?? null);
  const [site, setSite] = useState<PhotoItem[]>(
    initial?.site.map((p) => ({ key: p.evidenceId, src: p.src, status: 'done', evidenceId: p.evidenceId })) ?? [],
  );
  const [signature, setSignature] = useState<PhotoItem[]>(
    initial?.signature
      ? [
          {
            key: initial.signature.evidenceId,
            src: initial.signature.src,
            status: 'done',
            evidenceId: initial.signature.evidenceId,
          },
        ]
      : [],
  );
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [errors, setErrors] = useState<Partial<Record<Field | 'form', string>>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  // 08-ux-ui §6.8: leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const touch = () => (setDirty(true), setErrors({}));
  const uploading = [...site, ...signature].some((p) => p.status === 'uploading');
  const doneSite = site.filter((p) => p.status === 'done');
  const doneSignature = signature.find((p) => p.status === 'done') ?? null;

  const problem = useMemo(
    () =>
      checkContent(
        {
          score,
          studentScores: new Map(),
          siteCount: doneSite.length,
          hasSignature: doneSignature !== null,
          comment,
        },
        {
          max: ctx.max,
          step: ctx.step,
          photoMin: ctx.photoMin,
          photoMax: ctx.photoMax,
          requiresSignature: ctx.requiresSignature,
          commentMax: ctx.commentMax,
          rosterIds: null,
        },
      ),
    [score, doneSite.length, doneSignature, comment, ctx],
  );

  const addPhotos = (kind: 'site' | 'signature') => (files: File[]) => {
    touch();
    const set = kind === 'site' ? setSite : setSignature;
    for (const file of files) {
      const key = crypto.randomUUID();
      const src = URL.createObjectURL(file);
      set((list) => [...list, { key, src, status: 'uploading' }]);
      void (async () => {
        try {
          const out = await upload(await shrink(file), kind, target);
          set((list) => list.map((p) => (p.key === key ? { ...p, status: 'done', evidenceId: out.evidenceId } : p)));
        } catch (err) {
          set((list) =>
            list.map((p) => (p.key === key ? { ...p, status: 'error', error: (err as Error).message } : p)),
          );
        }
      })();
    }
  };
  const removePhoto = (kind: 'site' | 'signature') => (key: string) => {
    touch();
    (kind === 'site' ? setSite : setSignature)((list) => list.filter((p) => p.key !== key));
  };

  const submit = () => {
    if (problem) {
      setErrors({ [problem.field]: problem.message });
      document.getElementById(`card-${problem.field}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const content = {
      score: score === null ? null : toDb(score),
      siteEvidenceIds: doneSite.map((p) => p.evidenceId!),
      signatureEvidenceId: doneSignature?.evidenceId ?? null,
      comment,
    };
    start(async () => {
      const result = initial
        ? await updateEvaluationAction(
            { id: initial.evaluationId, expectedVersion: initial.version, ...content },
            initial.status === 'returned' ? 'resubmit' : 'update',
          )
        : await submitEvaluationAction({
            roundId: ctx.round.id,
            componentId: ctx.componentId,
            target: ctx.target,
            ...content,
          });
      if (result.ok) {
        setDirty(false);
        if (typeof navigator.vibrate === 'function') navigator.vibrate(30);
        router.push(`/tasks?saved=1`);
        return;
      }
      const field = (result.error.field ?? 'form') as Field | 'form';
      const known: (Field | 'form')[] = ['score', 'sitePhotos', 'signature', 'comment', 'studentScores'];
      setErrors({ [known.includes(field) ? field : 'form']: result.error.message });
    });
  };

  const counter = (n: number) => {
    const missing = ctx.photoMin - n;
    return (
      <span className={`text-[13px] ${missing > 0 ? 'text-warn-ink' : 'text-ink-muted'}`}>
        {n} / {ctx.photoMax}
        {missing > 0 ? ` · ต้องอีก ${missing} รูป` : ''}
      </span>
    );
  };
  const commentLength = [...comment].length;
  const buttonLabel = initial
    ? initial.status === 'returned'
      ? 'แก้แล้วส่งให้ Admin อนุมัติอีกครั้ง'
      : 'บันทึกการแก้ไข'
    : 'บันทึกและส่งให้ Admin อนุมัติ';

  return (
    <div className="flex flex-col gap-4 pb-40">
      <TargetHeader
        roomNumber={ctx.target.roomNumber}
        label={ctx.target.label}
        subtitle={ctx.target.subtitle}
        roundNo={ctx.round.roundNo}
      />

      <div id="card-score">
        <Card
          title={ctx.componentLabel}
          aside={
            <span className="text-[13px] text-ink-muted">
              เต็ม {show(ctx.max)} · {ctx.scoreFormat === 'integer' ? 'จำนวนเต็ม' : `ทีละ ${show(ctx.step)}`}
            </span>
          }
          error={errors.score}
          errorId="err-score"
        >
          <ScoreInput
            id="score"
            max={ctx.max}
            step={ctx.step}
            value={score}
            onChange={(v) => (touch(), setScore(v))}
            invalid={!!errors.score}
            describedBy={errors.score ? 'err-score' : undefined}
          />
        </Card>
      </div>

      <div id="card-sitePhotos">
        <Card title="รูปสถานที่" aside={counter(doneSite.length)} error={errors.sitePhotos} errorId="err-sitePhotos">
          <p className="mb-2 text-[13px] text-ink-muted">ถ่ายรูปหรือเลือกจากคลังรูป ระบบประทับวันเวลาลงรูปอัตโนมัติ</p>
          <PhotoGrid
            inputId="site-photos"
            items={site}
            max={ctx.photoMax}
            addLabel="ถ่ายรูป"
            onAdd={addPhotos('site')}
            onRemove={removePhoto('site')}
            describedBy={errors.sitePhotos ? 'err-sitePhotos' : undefined}
          />
        </Card>
      </div>

      {ctx.requiresSignature ? (
        <div id="card-signature">
          <Card title="ใบลงชื่อนักเรียน" error={errors.signature} errorId="err-signature">
            <PhotoGrid
              inputId="signature-photo"
              items={signature}
              max={1}
              addLabel="ถ่ายรูปใบลงชื่อ 1 รูป"
              onAdd={addPhotos('signature')}
              onRemove={removePhoto('signature')}
              describedBy={errors.signature ? 'err-signature' : undefined}
            />
          </Card>
        </div>
      ) : null}

      <div id="card-comment">
        <Card
          title="คำแนะนำและข้อติชม"
          aside={
            <span className={`text-[13px] ${commentLength > ctx.commentMax ? 'text-danger-ink' : 'text-ink-muted'}`}>
              {commentLength}/{ctx.commentMax}
            </span>
          }
          error={errors.comment}
          errorId="err-comment"
        >
          <label htmlFor="comment" className="sr-only">
            คำแนะนำและข้อติชม
          </label>
          <textarea
            id="comment"
            value={comment}
            onChange={(e) => (touch(), setComment(e.target.value))}
            rows={4}
            aria-invalid={!!errors.comment || undefined}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </Card>
      </div>

      {errors.form ? (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-[14px] text-danger-ink">
          {errors.form}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[720px] flex-col gap-1">
          <button
            type="button"
            onClick={submit}
            disabled={pending || uploading}
            className="h-14 w-full rounded-[14px] bg-brand text-[16px] font-bold text-white disabled:opacity-60"
          >
            {pending ? 'กำลังส่ง…' : uploading ? 'กำลังอัปโหลดรูป…' : buttonLabel}
          </button>
          <p className="text-center text-[13px] text-ink-muted" aria-live="polite">
            {problem ? problem.message : `แก้ไขเองได้ภายใน ${ctx.selfEditHours} ชั่วโมงหลังบันทึก`}
          </p>
        </div>
      </div>
    </div>
  );
}
