'use client';

import { useActionState, useMemo, useState } from 'react';
import { ActionMessage, inputCls, primaryCls, type MessageState } from '@/components/app/settings';
import { assignDutyAction } from './actions';

export interface UserOption {
  id: string;
  label: string;
  isAdmin: boolean;
}
export interface TargetGroupOption {
  title: string;
  targets: { value: string; label: string }[];
}

/** 08-ux-ui §6.13: assign (search by name), committee or approver, optional freelance with expiry. */
export function AssignForm({
  termId,
  users,
  groups,
  minExpiry,
}: {
  termId: string;
  users: UserOption[];
  groups: TargetGroupOption[];
  minExpiry: string;
}) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(assignDutyAction, null);
  const [query, setQuery] = useState('');
  const [duty, setDuty] = useState<'committee' | 'approver' | 'area_teacher'>('committee');
  const [freelance, setFreelance] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => (duty !== 'approver' || u.isAdmin) && (!q || u.label.toLowerCase().includes(q)));
  }, [users, query, duty]);

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="termId" value={termId} />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="d-search" className="text-[13px] font-semibold">
          ค้นหาชื่อ
        </label>
        <input
          id="d-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="พิมพ์ชื่อหรือ username"
          className={inputCls}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="d-user" className="text-[13px] font-semibold">
          ผู้ใช้ ({shown.length})
        </label>
        <select id="d-user" name="userId" required className={inputCls} key={`${query}|${duty}`}>
          {shown.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="d-duty" className="text-[13px] font-semibold">
          หน้าที่
        </label>
        <select
          id="d-duty"
          name="duty"
          value={duty}
          onChange={(e) =>
            setDuty(e.target.value === 'approver' || e.target.value === 'area_teacher' ? e.target.value : 'committee')
          }
          className={inputCls}
        >
          <option value="committee">กรรมการประเมิน</option>
          <option value="approver">ผู้อนุมัติ (ผู้ดูแลระบบเท่านั้น)</option>
          <option value="area_teacher">ครูผู้รับผิดชอบพื้นที่ (หักคะแนนห้องในพื้นที่)</option>
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="d-target" className="text-[13px] font-semibold">
          ห้องเรียนหรือพื้นที่
        </label>
        <select id="d-target" name="target" required={duty !== 'approver'} className={inputCls} key={duty}>
          {duty === 'approver' ? <option value="">ทุกรายการ</option> : null}
          {/* an area teacher is responsible for a building or zone (T41) */}
          {groups
            .filter((g) => duty !== 'area_teacher' || g.targets.some((t) => t.value.startsWith('area:')))
            .map((g) => (
              <optgroup key={g.title} label={g.title}>
                {g.targets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </div>
      {duty === 'committee' ? (
        <div className="flex flex-col gap-2 md:col-span-2">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="isFreelance"
              checked={freelance}
              onChange={(e) => setFreelance(e.target.checked)}
              className="size-5"
            />
            มอบหมายชั่วคราว (Freelance)
          </label>
          {freelance ? (
            <div className="flex max-w-xs min-w-0 flex-col gap-1">
              <label htmlFor="d-until" className="text-[13px] font-semibold">
                ใช้ได้ถึง (เวลาไทย)
              </label>
              <input
                id="d-until"
                name="validUntil"
                type="datetime-local"
                min={minExpiry}
                required
                className={inputCls}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" disabled={pending || shown.length === 0} className={primaryCls}>
          มอบหมาย
        </button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}
