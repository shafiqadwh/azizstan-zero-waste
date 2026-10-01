'use client';

import { useActionState } from 'react';
import { ActionMessage, buttonCls, inputCls, primaryCls, type MessageState } from '@/components/app/settings';
import { addSkipRuleAction, mapClassAction, removeSkipRuleAction, requestSyncAction } from './actions';

export function SyncNowButton({ pending: queued }: { pending: boolean }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(requestSyncAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button type="submit" disabled={pending} className={primaryCls}>
        sync ตอนนี้
      </button>
      {queued && !state ? <p className="text-[13px] text-ink-muted">มีคำสั่ง sync รออยู่</p> : null}
      <ActionMessage state={state} />
    </form>
  );
}

export function MapClassForm({ alias, classes }: { alias: string; classes: { id: string; display: string }[] }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(mapClassAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" aria-label={`จับคู่ ${alias}`}>
      <input type="hidden" name="alias" value={alias} />
      <select name="classId" required defaultValue="" className={`${inputCls} w-auto`} aria-label="จับคู่กับห้อง">
        <option value="" disabled>
          จับคู่กับห้อง…
        </option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.display}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={buttonCls}>
        บันทึก
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function AddSkipRuleForm() {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(addSkipRuleAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        คำขึ้นต้นของชั้น
        <input name="prefix" required placeholder="มุตะวัซซิต" className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        หมายเหตุ
        <input name="note" className={inputCls} />
      </label>
      <button type="submit" disabled={pending} className={buttonCls}>
        เพิ่ม
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function RemoveSkipRuleButton({ id, prefix }: { id: string; prefix: string }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(removeSkipRuleAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={buttonCls} aria-label={`ลบ ${prefix}`}>
        ลบ
      </button>
      <ActionMessage state={state} />
    </form>
  );
}
