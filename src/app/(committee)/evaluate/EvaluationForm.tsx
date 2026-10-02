'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { PhotoGrid, type PhotoItem } from '@/components/app/PhotoGrid';
import { ScoreInput } from '@/components/app/ScoreInput';
import { TargetHeader } from '@/components/app/TargetHeader';
import { checkContent, type ContentError } from '@/lib/evaluation/validate';
import {
  draftKey,
  hasContent,
  isExpired,
  isNetworkError,
  reusableEvidence,
  type Draft,
  type DraftPhoto,
} from '@/lib/offline/draft';
import { deleteDraft, readDraft, saveDraft } from '@/lib/offline/draft-store';
import { useOnline } from '@/lib/offline/use-online';
import { toDisplay, toDb, type Th } from '@/lib/scoring/decimal';
import { trimScore } from '@/lib/term/config';
import type { EvaluationForm as FormContext } from '@/server/services/task.service';
import { submitEvaluationAction, updateEvaluationAction } from './actions';
import { shrink, upload } from './upload';

type Field = ContentError['field'];
type Kind = 'site' | 'signature';
/** The shrunk blob stays with the photo so it can be queued offline and saved in the draft. */
type FormPhoto = PhotoItem & { blob?: Blob; uploadedAt?: number };

/** How often queued photos and a confirmed submit retry while the phone claims a signal it cannot use. */
const RETRY_MS = 15_000;

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
  const online = useOnline();
  const target = `${ctx.target.type}:${ctx.target.id}`;
  // 07-frontend §3.5: new evaluations keep a local draft; an edit starts from the saved evaluation instead.
  const key = initial ? null : draftKey(ctx.round.id, ctx.componentId, target);
  const [score, setScore] = useState<Th | null>(initial?.score ?? null);
  const [site, setSite] = useState<FormPhoto[]>(
    initial?.site.map((p) => ({ key: p.evidenceId, src: p.src, status: 'done', evidenceId: p.evidenceId })) ?? [],
  );
  const [signature, setSignature] = useState<FormPhoto[]>(
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
  /** the user confirmed submit; it goes out once there is signal and every photo is uploaded */
  const [submitRequested, setSubmitRequested] = useState(false);
  /** null until the stored draft has been read, so an empty form never overwrites it */
  const [loaded, setLoaded] = useState(key === null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const lists = useRef<Record<Kind, FormPhoto[]>>({ site, signature });
  useEffect(() => {
    lists.current = { site, signature };
  }, [site, signature]);
  const inflight = useRef(new Set<string>());

  // 08-ux-ui §6.8: leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setList = (kind: Kind) => (kind === 'site' ? setSite : setSignature);

  const startUpload = useCallback(
    (kind: Kind, photoKey: string, blob: Blob) => {
      if (inflight.current.has(photoKey)) return;
      const set = kind === 'site' ? setSite : setSignature;
      const patch = (p: Partial<FormPhoto>) =>
        set((list) => list.map((x) => (x.key === photoKey ? { ...x, ...p } : x)));
      if (!navigator.onLine) return patch({ status: 'queued' });
      inflight.current.add(photoKey);
      patch({ status: 'uploading', error: undefined });
      void upload(blob, kind, target)
        .then((out) => patch({ status: 'done', evidenceId: out.evidenceId, uploadedAt: Date.now() }))
        .catch((err: unknown) =>
          isNetworkError(err, navigator.onLine)
            ? patch({ status: 'queued' })
            : patch({ status: 'error', error: (err as Error).message }),
        )
        .finally(() => inflight.current.delete(photoKey));
    },
    [target],
  );

  // restore the local draft once (07-frontend §3.5)
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void readDraft(key).then((d) => {
      if (cancelled) return;
      if (d && !isExpired(d, Date.now())) {
        const now = Date.now();
        const revive = (p: DraftPhoto): FormPhoto => {
          const evidenceId = reusableEvidence(p, now);
          return {
            key: p.key,
            src: URL.createObjectURL(p.blob),
            blob: p.blob,
            status: evidenceId ? 'done' : 'queued',
            evidenceId,
            uploadedAt: evidenceId ? p.uploadedAt : undefined,
          };
        };
        const restored = { site: d.site.map(revive), signature: d.signature.map(revive) };
        setScore(d.score === null ? null : (d.score as Th));
        setComment(d.comment);
        setSite(restored.site);
        setSignature(restored.signature);
        setSubmitRequested(d.submitRequested);
        setRestoredAt(d.updatedAt);
        setDirty(true);
        lists.current = restored;
        for (const kind of ['site', 'signature'] as const)
          for (const p of restored[kind]) if (p.status === 'queued') startUpload(kind, p.key, p.blob!);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [key, startUpload]);

  // keep the draft in step with the form (debounced: the comment changes per keystroke)
  useEffect(() => {
    if (!key || !loaded || !dirty) return;
    const keep = (list: FormPhoto[]): DraftPhoto[] =>
      list
        .filter((p) => p.blob && p.status !== 'error')
        .map((p) => ({
          key: p.key,
          blob: p.blob!,
          evidenceId: p.status === 'done' ? p.evidenceId : undefined,
          uploadedAt: p.status === 'done' ? p.uploadedAt : undefined,
        }));
    const draft: Draft = {
      key,
      updatedAt: Date.now(),
      score,
      comment,
      site: keep(site),
      signature: keep(signature),
      submitRequested,
    };
    const id = setTimeout(() => void (hasContent(draft) ? saveDraft(draft) : deleteDraft(key)), 300);
    return () => clearTimeout(id);
  }, [key, loaded, dirty, score, comment, site, signature, submitRequested]);

  const touch = () => (setDirty(true), setErrors({}), setSubmitRequested(false));
  const all = [...site, ...signature];
  const uploading = all.some((p) => p.status === 'uploading');
  const waiting = all.some((p) => p.status === 'queued') || submitRequested;
  const allDone = all.every((p) => p.status === 'done' || p.status === 'error');
  // photos still on their way count: offline they are what the user will send
  const present = (list: FormPhoto[]) => list.filter((p) => p.status !== 'error');
  const sitePresent = present(site).length;
  const signaturePresent = present(signature).length > 0;
  const doneSite = useMemo(() => site.filter((p) => p.status === 'done'), [site]);
  const doneSignature = useMemo(() => signature.find((p) => p.status === 'done') ?? null, [signature]);

  // retry queued work when the signal returns, and every 15 s while the phone claims one it cannot use
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setTick((t) => t + 1), RETRY_MS);
    return () => clearInterval(id);
  }, [waiting]);
  useEffect(() => {
    if (!online) return;
    for (const kind of ['site', 'signature'] as const)
      for (const p of lists.current[kind]) if (p.status === 'queued' && p.blob) startUpload(kind, p.key, p.blob);
  }, [online, tick, startUpload]);

  const problem = useMemo(
    () =>
      checkContent(
        {
          score,
          studentScores: new Map(),
          siteCount: sitePresent,
          hasSignature: signaturePresent,
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
    [score, sitePresent, signaturePresent, comment, ctx],
  );

  const addPhotos = (kind: Kind) => (files: File[]) => {
    touch();
    for (const file of files) {
      const photoKey = crypto.randomUUID();
      const src = URL.createObjectURL(file);
      setList(kind)((list) => [...list, { key: photoKey, src, status: 'uploading' }]);
      void shrink(file).then((blob) => {
        setList(kind)((list) => list.map((p) => (p.key === photoKey ? { ...p, blob } : p)));
        startUpload(kind, photoKey, blob);
      });
    }
  };
  const removePhoto = (kind: Kind) => (photoKey: string) => {
    touch();
    setList(kind)((list) => list.filter((p) => p.key !== photoKey));
  };

  const retryAfter = useRef(0);
  const send = useCallback(() => {
    const content = {
      score: score === null ? null : toDb(score),
      siteEvidenceIds: doneSite.map((p) => p.evidenceId!),
      signatureEvidenceId: doneSignature?.evidenceId ?? null,
      comment,
    };
    start(async () => {
      let result;
      try {
        result = initial
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
      } catch (err) {
        // never reached the server: keep the request and try again with the next signal
        if (isNetworkError(err, navigator.onLine)) {
          retryAfter.current = Date.now() + RETRY_MS / 3;
          return;
        }
        throw err;
      }
      setSubmitRequested(false);
      if (result.ok) {
        setDirty(false);
        if (key) await deleteDraft(key);
        if (typeof navigator.vibrate === 'function') navigator.vibrate(30);
        router.push(`/tasks?saved=1`);
        return;
      }
      const field = (result.error.field ?? 'form') as Field | 'form';
      const known: (Field | 'form')[] = ['score', 'sitePhotos', 'signature', 'comment', 'studentScores'];
      setErrors({ [known.includes(field) ? field : 'form']: result.error.message });
    });
  }, [score, doneSite, doneSignature, comment, initial, ctx, key, router]);

  // 07-frontend §3.5: submits by itself once every upload finished and the user confirmed
  const sending = useRef(false);
  useEffect(() => {
    sending.current = pending;
  }, [pending]);
  useEffect(() => {
    if (online) retryAfter.current = 0; // the signal just came back: no need to wait
  }, [online]);
  useEffect(() => {
    if (!submitRequested || !online || !allDone || problem || sending.current) return;
    if (Date.now() < retryAfter.current) return;
    sending.current = true;
    send();
    // `tick` retries a send that failed on a signal the phone only claimed to have
  }, [submitRequested, online, allDone, problem, tick, send]);

  const submit = () => {
    if (problem) {
      setErrors({ [problem.field]: problem.message });
      document.getElementById(`card-${problem.field}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setErrors({});
    setSubmitRequested(true);
  };

  const clearDraft = async () => {
    if (key) await deleteDraft(key);
    setDirty(false);
    window.location.reload();
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

      {restoredAt !== null ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-soft px-4 py-3"
        >
          <span className="text-[14px] text-brand-ink">
            กู้คืนร่างที่บันทึกไว้ในเครื่องเมื่อ{' '}
            {new Date(restoredAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          <button
            type="button"
            onClick={() => void clearDraft()}
            className="h-11 rounded-md px-3 text-[14px] font-semibold text-brand-ink underline"
          >
            ล้างร่าง
          </button>
        </div>
      ) : null}

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
        <Card title="รูปสถานที่" aside={counter(sitePresent)} error={errors.sitePhotos} errorId="err-sitePhotos">
          <p className="mb-2 text-[13px] text-ink-muted">
            ถ่ายเฉพาะพื้นที่ หลีกเลี่ยงการถ่ายใบหน้านักเรียน · ถ่ายรูปหรือเลือกจากคลังรูป
            ระบบประทับวันเวลาลงรูปอัตโนมัติ
          </p>
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
            {ctx.target.type === 'class' ? (
              <p className="mb-2 text-[13px] text-ink-muted">
                ยังไม่มีใบลงชื่อ?{' '}
                <a
                  href={`/api/v1/pdf/signature-sheet?classId=${ctx.target.id}&roundId=${ctx.round.id}`}
                  target="_blank"
                  rel="noopener"
                  className="font-semibold text-brand-ink underline"
                >
                  พิมพ์ใบลงชื่อ (PDF)
                </a>
              </p>
            ) : null}
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
            disabled={pending || submitRequested || (uploading && online)}
            className="h-14 w-full rounded-[14px] bg-brand text-[16px] font-bold text-white disabled:opacity-60"
          >
            {pending
              ? 'กำลังส่ง…'
              : submitRequested && (!online || !allDone)
                ? 'จะส่งเมื่อมีสัญญาณ'
                : submitRequested
                  ? 'กำลังส่ง…'
                  : uploading && online
                    ? 'กำลังอัปโหลดรูป…'
                    : buttonLabel}
          </button>
          <p className="text-center text-[13px] text-ink-muted" aria-live="polite">
            {submitRequested
              ? 'ส่งให้อัตโนมัติเมื่อมีสัญญาณและอัปโหลดรูปครบ · แก้ข้อมูลเพื่อยกเลิก'
              : problem
                ? problem.message
                : !online
                  ? 'ออฟไลน์ · ร่างถูกเก็บไว้ในเครื่อง'
                  : `แก้ไขเองได้ภายใน ${ctx.selfEditHours} ชั่วโมงหลังบันทึก`}
          </p>
        </div>
      </div>
    </div>
  );
}
