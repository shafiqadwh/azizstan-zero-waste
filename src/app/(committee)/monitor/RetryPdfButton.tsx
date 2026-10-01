'use client';

import { useState, useTransition } from 'react';
import { retryPdfAction } from './actions';

export function RetryPdfButton({ evaluationId }: { evaluationId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await retryPdfAction(evaluationId);
            setError(r.ok ? null : r.error.message);
          })
        }
        className="h-9 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-semibold disabled:opacity-60"
      >
        สร้างใหม่
      </button>
      {error ? (
        <span role="alert" className="text-[12px] text-danger-ink">
          {error}
        </span>
      ) : null}
    </span>
  );
}
