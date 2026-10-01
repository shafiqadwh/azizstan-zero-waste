'use client';

import { X } from 'lucide-react';
import { useActionState } from 'react';
import type { MessageState } from '@/components/app/settings';
import { removeDutyAction } from './actions';

/** A committee chip with its remove button; the error (if any) shows under the chip. */
export function DutyChip({
  dutyId,
  name,
  target,
  note,
  canManage,
}: {
  dutyId: string;
  name: string;
  target: string;
  note?: string;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(removeDutyAction, null);
  return (
    <li className="flex min-w-0 flex-col">
      <form
        action={action}
        className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-line bg-surface-muted py-1 pr-1 pl-3 text-[13px]"
      >
        <span className="truncate">
          {name}
          {note ? <span className="text-ink-muted"> · {note}</span> : null}
        </span>
        {canManage ? (
          <>
            <input type="hidden" name="dutyId" value={dutyId} />
            <button
              type="submit"
              disabled={pending}
              aria-label={`นำ ${name} ออกจาก ${target}`}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-surface disabled:opacity-60"
            >
              <X size={14} aria-hidden />
            </button>
          </>
        ) : null}
      </form>
      {state && !state.ok ? (
        <p role="alert" className="text-[12px] text-danger-ink">
          {state.error.message}
        </p>
      ) : null}
    </li>
  );
}
