'use client';

import { Minus, Plus } from 'lucide-react';
import { useActionState } from 'react';
import { ActionMessage, buttonCls, Card, inputCls, type MessageState } from '@/components/app/settings';
import { saveRoundDatesAction, setRoundCountAction } from './actions';

export interface RoundValue {
  id: string;
  roundNo: number;
  status: 'scheduled' | 'open' | 'closed' | 'finalized';
  opensAt: string; // yyyy-MM-ddTHH:mm, Bangkok wall clock
  closesAt: string;
}

const STATUS = {
  scheduled: 'ยังไม่เปิด',
  open: 'เปิดลงคะแนน',
  closed: 'ปิดรับคะแนน',
  finalized: 'ปิดรอบแล้ว',
} as const;

function RoundRow({ round, canManage }: { round: RoundValue; canManage: boolean }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(saveRoundDatesAction, null);
  // BR-R5: scheduled → both dates; open/closed → only extend close; finalized → fixed
  const openLocked = !canManage || round.status !== 'scheduled';
  const closeLocked = !canManage || round.status === 'finalized';
  return (
    <li className="border-b border-line py-3 last:border-0">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="roundId" value={round.id} />
        {openLocked ? <input type="hidden" name="opensAt" value={round.opensAt} /> : null}
        <div className="w-[120px]">
          <p className="font-semibold">รอบที่ {round.roundNo}</p>
          <p className="text-[13px] text-ink-muted">{STATUS[round.status]}</p>
          <a href={`/admin/settings/rounds/${round.id}`} className="text-[13px] text-brand-ink underline">
            พื้นที่ของห้องเรียน
          </a>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`open-${round.id}`} className="text-[13px] font-semibold">
            เปิดลงคะแนน
          </label>
          <input
            id={`open-${round.id}`}
            type="datetime-local"
            name={openLocked ? undefined : 'opensAt'}
            defaultValue={round.opensAt}
            disabled={openLocked}
            className={inputCls}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`close-${round.id}`} className="text-[13px] font-semibold">
            ปิดรับคะแนน
          </label>
          <input
            id={`close-${round.id}`}
            type="datetime-local"
            name="closesAt"
            defaultValue={round.closesAt}
            disabled={closeLocked}
            className={inputCls}
          />
        </div>
        {!closeLocked ? (
          <button type="submit" disabled={pending} className={buttonCls}>
            บันทึกวันที่
          </button>
        ) : null}
        <div className="w-full">
          <ActionMessage state={state} />
        </div>
      </form>
    </li>
  );
}

export function RoundsCard({
  termId,
  rounds,
  canManage,
  countLocked,
}: {
  termId: string;
  rounds: RoundValue[];
  canManage: boolean;
  countLocked: boolean;
}) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(setRoundCountAction, null);
  const count = rounds.length;
  return (
    <Card title="รอบการประเมิน" id="rounds">
      <form action={action} className="mb-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="termId" value={termId} />
        <span id="round-count-label" className="text-[14px] font-semibold">
          จำนวนรอบต่อภาคเรียน
        </span>
        <div className="flex items-center gap-2" role="group" aria-labelledby="round-count-label">
          <button
            type="submit"
            name="count"
            value={count - 1}
            disabled={countLocked || pending || count <= 1}
            aria-label="ลดจำนวนรอบ"
            className={`${buttonCls} w-11 px-0`}
          >
            <Minus size={18} aria-hidden className="mx-auto" />
          </button>
          <output aria-live="polite" className="w-8 text-center text-[20px] font-bold" data-testid="round-count">
            {count}
          </output>
          <button
            type="submit"
            name="count"
            value={count + 1}
            disabled={countLocked || pending || count >= 10}
            aria-label="เพิ่มจำนวนรอบ"
            className={`${buttonCls} w-11 px-0`}
          >
            <Plus size={18} aria-hidden className="mx-auto" />
          </button>
        </div>
        <ActionMessage state={state} />
      </form>
      {rounds.length === 0 ? (
        <p>ยังไม่มีรอบ · กดเพิ่มจำนวนรอบ</p>
      ) : (
        <ul>
          {rounds.map((r) => (
            <RoundRow key={`${r.id}-${r.opensAt}-${r.closesAt}`} round={r} canManage={canManage} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-ink-muted">
        เวลาเป็นเวลาประเทศไทย · รอบที่เปิดแล้วแก้ได้เฉพาะขยายวันปิดรับคะแนน
      </p>
    </Card>
  );
}
