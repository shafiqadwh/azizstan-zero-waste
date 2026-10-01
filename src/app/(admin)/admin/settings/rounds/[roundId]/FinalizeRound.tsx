'use client';

import { useActionState } from 'react';
import { ActionMessage, type MessageState } from '@/components/app/settings';
import { finalizeRoundAction } from './actions';

/** BR-R3 "ปิดรอบ": disabled with the reason until every class and area has an approved score (08-ux-ui §6.10). */
export function FinalizeRound({ roundId, blocker }: { roundId: string; blocker: string | null }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(finalizeRoundAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="roundId" value={roundId} />
      <button
        type="submit"
        disabled={pending || blocker !== null}
        className="h-12 w-fit rounded-[12px] bg-brand px-6 font-semibold text-white disabled:bg-surface-muted disabled:text-ink-muted"
      >
        ปิดรอบ
      </button>
      {blocker ? <p className="text-[13px] text-ink-muted">{blocker}</p> : null}
      <ActionMessage state={state} />
    </form>
  );
}
