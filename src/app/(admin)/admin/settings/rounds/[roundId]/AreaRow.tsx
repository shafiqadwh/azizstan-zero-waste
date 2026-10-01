'use client';

import { useActionState } from 'react';
import { ActionMessage, buttonCls, inputCls, type MessageState } from '@/components/app/settings';
import { editRoundClassAreaAction } from './actions';

/** One class of the round: its frozen area, editable while the round is open or closed (BR-R4). */
export function AreaRow({
  roundId,
  classId,
  label,
  roomNumber,
  areaId,
  areas,
  editable,
  scheduled,
}: {
  roundId: string;
  classId: string;
  label: string;
  roomNumber: string | null;
  areaId: string | null;
  areas: { id: string; name: string }[];
  editable: boolean;
  scheduled: boolean;
}) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(editRoundClassAreaAction, null);
  const areaName = areas.find((a) => a.id === areaId)?.name;
  return (
    <li
      data-testid={`round-class-${label}`}
      className={`flex flex-col gap-2 rounded-lg border p-3 ${areaId || scheduled ? 'border-line' : 'border-danger bg-danger-soft'}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-semibold">
          {label}
          {roomNumber ? <span className="font-normal text-ink-muted"> · ห้อง {roomNumber}</span> : null}
        </span>
        {areaId || scheduled ? null : <span className="text-[13px] font-semibold text-danger-ink">ไม่มีพื้นที่</span>}
      </div>
      {editable ? (
        <form action={action} className="flex min-w-0 flex-wrap items-center gap-2">
          <input type="hidden" name="roundId" value={roundId} />
          <input type="hidden" name="classId" value={classId} />
          <label htmlFor={`area-${classId}`} className="sr-only">
            พื้นที่ของ {label}
          </label>
          <select
            id={`area-${classId}`}
            name="areaId"
            defaultValue={areaId ?? ''}
            required
            className={`${inputCls} w-auto min-w-[10rem] flex-1`}
          >
            <option value="" disabled>
              เลือกพื้นที่
            </option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} className={buttonCls}>
            บันทึก
          </button>
          <ActionMessage state={state} />
        </form>
      ) : (
        <p className="text-[14px] text-ink-muted">{scheduled ? 'กำหนดเมื่อเปิดรอบ' : (areaName ?? '–')}</p>
      )}
    </li>
  );
}
