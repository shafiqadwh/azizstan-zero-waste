'use client';

import { useActionState } from 'react';
import { ActionMessage, buttonCls, type MessageState } from '@/components/app/settings';
import { remindCommitteesAction } from './actions';

/** §6.10 "แจ้งเตือนกรรมการที่ค้าง". */
export function RemindButton() {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(remindCommitteesAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button type="submit" disabled={pending} className={buttonCls}>
        แจ้งเตือนกรรมการที่ค้าง
      </button>
      <ActionMessage state={state} />
    </form>
  );
}
