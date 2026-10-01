'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteEvaluationAction } from '../actions';

/** BR-E5 with a confirm step (08-ux-ui §4.1: destructive actions always confirm). */
export function DeleteEvaluation({ id, version }: { id: string; version: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="h-12 rounded-[12px] border border-line-strong bg-surface px-5 font-semibold text-danger-ink"
      >
        ลบ
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label="ยืนยันลบผลประเมิน" className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await deleteEvaluationAction(id, version);
              if (r.ok) router.push('/tasks');
              else setError(r.error.message);
            })
          }
          className="h-12 rounded-[12px] bg-danger px-4 font-semibold text-white disabled:opacity-60"
        >
          ยืนยันลบ
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="h-12 rounded-[12px] border border-line-strong px-4"
        >
          ยกเลิก
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
