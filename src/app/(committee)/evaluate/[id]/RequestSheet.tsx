'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { PhotoGrid, type PhotoItem } from '@/components/app/PhotoGrid';
import { ScoreInput } from '@/components/app/ScoreInput';
import { toDb, type Th } from '@/lib/scoring/decimal';
import { createRequestAction } from '../request-actions';
import { shrink, upload } from '../upload';

type Type = 'edit_score' | 'edit_photos' | 'edit_comment' | 'move_target' | 'delete';

const TYPES: { type: Type; label: string; ownerOnly?: boolean }[] = [
  { type: 'edit_score', label: 'แก้คะแนน' },
  { type: 'edit_photos', label: 'แก้รูป' },
  { type: 'edit_comment', label: 'แก้ข้อติชม' },
  { type: 'move_target', label: 'ย้ายไปห้องที่ถูกต้อง', ownerOnly: true },
  { type: 'delete', label: 'ลบผลประเมิน' },
];

const input =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-brand';

/**
 * 08-ux-ui §6.9 "ขออนุมัติแก้ไข": request type, the new value for that type, reason (≥ 5 characters, BR-Q1).
 * Admins see old → new side by side and approve or reject (BR-Q2).
 */
export function RequestSheet({
  evaluationId,
  target,
  isOwner,
  score,
  max,
  step,
  comment,
  photos,
  photoMax,
  moveOptions,
}: {
  evaluationId: string;
  target: string;
  isOwner: boolean;
  score: Th | null;
  max: Th;
  step: Th;
  comment: string;
  photos: { id: string; kind: 'site' | 'signature'; thumb: string }[];
  photoMax: number;
  moveOptions: { type: 'class' | 'area'; id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<Type>('edit_score');
  const [newScore, setNewScore] = useState<Th | null>(score);
  const [newComment, setNewComment] = useState(comment);
  const [remove, setRemove] = useState<string[]>([]);
  const [added, setAdded] = useState<PhotoItem[]>([]);
  const [moveTo, setMoveTo] = useState(moveOptions[0] ? `${moveOptions[0].type}:${moveOptions[0].id}` : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 w-full rounded-[12px] border border-line-strong bg-surface font-semibold"
      >
        ขออนุมัติแก้ไข
      </button>
    );
  }

  const addPhotos = (files: File[]) => {
    for (const file of files) {
      const key = crypto.randomUUID();
      setAdded((l) => [...l, { key, src: URL.createObjectURL(file), status: 'uploading' }]);
      void (async () => {
        try {
          const out = await upload(await shrink(file), 'site', target);
          setAdded((l) => l.map((p) => (p.key === key ? { ...p, status: 'done', evidenceId: out.evidenceId } : p)));
        } catch (err) {
          setAdded((l) => l.map((p) => (p.key === key ? { ...p, status: 'error', error: (err as Error).message } : p)));
        }
      })();
    }
  };

  const payload = (): Record<string, unknown> | null => {
    switch (type) {
      case 'edit_score':
        return { score: newScore === null ? null : toDb(newScore) };
      case 'edit_comment':
        return { comment: newComment };
      case 'edit_photos':
        return { add: added.filter((p) => p.status === 'done').map((p) => p.evidenceId!), remove };
      case 'move_target': {
        const [t, id] = moveTo.split(':');
        return t && id ? { target: { type: t, id } } : null;
      }
      case 'delete':
        return {};
    }
  };

  const send = () => {
    const p = payload();
    if (!p) return setError({ field: 'target', message: 'กรุณาเลือกห้องที่ถูกต้อง' });
    if ([...reason.trim()].length < 5)
      return setError({ field: 'reason', message: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    start(async () => {
      const r = await createRequestAction({ type, evaluationId, reason, payload: p });
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError({ field: r.error.field, message: r.error.message });
    });
  };

  return (
    <section
      aria-label="ขออนุมัติแก้ไข"
      className="flex flex-col gap-3 rounded-[18px] border border-line-strong bg-surface p-4"
    >
      <h2 className="text-[16px] font-bold">ขออนุมัติแก้ไข</h2>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[13px] font-semibold">ประเภทคำขอ</legend>
        {TYPES.filter((t) => !t.ownerOnly || isOwner).map((t) => (
          <label key={t.type} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="request-type"
              value={t.type}
              checked={type === t.type}
              onChange={() => (setType(t.type), setError(null))}
              className="size-5"
            />
            {t.label}
          </label>
        ))}
      </fieldset>

      {type === 'edit_score' ? (
        <div>
          <p className="mb-2 text-[13px] font-semibold">คะแนนใหม่</p>
          <ScoreInput id="request-score" max={max} step={step} value={newScore} onChange={setNewScore} />
        </div>
      ) : null}
      {type === 'edit_comment' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="request-comment" className="text-[13px] font-semibold">
            ข้อติชมใหม่
          </label>
          <textarea
            id="request-comment"
            rows={3}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className={input}
          />
        </div>
      ) : null}
      {type === 'edit_photos' ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold">เลือกรูปที่จะลบ</p>
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <li key={p.id}>
                <label className="flex flex-col items-center gap-1 text-[13px]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API image */}
                  <img src={p.thumb} alt="" className="aspect-square w-full rounded-[14px] object-cover" />
                  <span className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={remove.includes(p.id)}
                      onChange={(e) =>
                        setRemove((r) => (e.target.checked ? [...r, p.id] : r.filter((x) => x !== p.id)))
                      }
                      className="size-5"
                      aria-label={`ลบรูปที่ ${i + 1}`}
                    />
                    ลบ
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-[13px] font-semibold">เพิ่มรูปใหม่</p>
          <PhotoGrid
            inputId="request-photos"
            items={added}
            max={Math.max(0, photoMax - photos.filter((p) => p.kind === 'site').length + remove.length)}
            addLabel="ถ่ายรูป"
            onAdd={addPhotos}
            onRemove={(key) => setAdded((l) => l.filter((p) => p.key !== key))}
          />
        </div>
      ) : null}
      {type === 'move_target' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="request-move" className="text-[13px] font-semibold">
            ห้องที่ถูกต้อง
          </label>
          {moveOptions.length === 0 ? (
            <p className="text-[14px] text-ink-muted">ไม่มีห้องอื่นในรายการของคุณที่ยังไม่ได้ประเมิน</p>
          ) : (
            <select id="request-move" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={input}>
              {moveOptions.map((o) => (
                <option key={o.id} value={`${o.type}:${o.id}`}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}
      {type === 'delete' ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-[14px] text-danger-ink">
          เมื่ออนุมัติ ผลประเมินนี้จะถูกลบ และห้องนี้กลับเป็น “ยังไม่ประเมิน”
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="request-reason" className="text-[13px] font-semibold">
          เหตุผล
        </label>
        <textarea
          id="request-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={error?.field === 'reason' || undefined}
          className={input}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-danger-ink">
          {error.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || added.some((p) => p.status === 'uploading')}
          onClick={send}
          className="h-12 flex-1 rounded-[12px] bg-brand font-semibold text-white disabled:opacity-60"
        >
          ส่งคำขอ
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-12 rounded-[12px] border border-line-strong px-4"
        >
          ยกเลิก
        </button>
      </div>
    </section>
  );
}
