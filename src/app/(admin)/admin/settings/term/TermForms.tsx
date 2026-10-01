'use client';

import { useActionState } from 'react';
import { ActionMessage, buttonCls, inputCls, primaryCls, type MessageState } from '@/components/app/settings';
import { activateTermAction, closeTermAction, createTermAction } from './actions';

export function CreateTermForm({
  terms,
  suggested,
}: {
  terms: { id: string; label: string }[];
  suggested: { academicYear: number; termNo: number };
}) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(createTermAction, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-4">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="t-year" className="text-[13px] font-semibold">
          ปีการศึกษา (พ.ศ.)
        </label>
        <input
          id="t-year"
          name="academicYear"
          type="number"
          min={2560}
          max={2700}
          defaultValue={suggested.academicYear}
          required
          className={inputCls}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="t-no" className="text-[13px] font-semibold">
          ภาคเรียน
        </label>
        <select id="t-no" name="termNo" defaultValue={suggested.termNo} className={inputCls}>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1 md:col-span-2">
        <label htmlFor="t-copy" className="text-[13px] font-semibold">
          คัดลอกการตั้งค่าจาก
        </label>
        <select id="t-copy" name="copyFromTermId" defaultValue={terms[0]?.id ?? ''} className={inputCls}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          <option value="">ไม่คัดลอก (ใช้ค่าเริ่มต้น)</option>
        </select>
      </div>
      <fieldset className="flex flex-col gap-1 md:col-span-4">
        <legend className="mb-1 text-[13px] font-semibold">สิ่งที่คัดลอก</legend>
        <p className="text-[14px] text-ink-muted">
          กติกาและส่วนคะแนน (คัดลอกเสมอ) · ห้องเรียนที่ใช้ (เฉพาะปีการศึกษาเดียวกัน)
        </p>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="copyZones" defaultChecked className="size-5" /> โซนและห้องที่รับผิดชอบ
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="copyDuties" className="size-5" /> คัดลอกผู้ประเมินจากเทอมก่อน
        </label>
      </fieldset>
      <p className="text-[13px] text-ink-muted md:col-span-4">ข้อมูลเทอมก่อนไม่ถูกลบ ดูย้อนหลังและเทียบกราฟได้ตลอด</p>
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <button type="submit" disabled={pending} className={primaryCls}>
          สร้างภาคเรียน
        </button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

export function ActivateButton({ termId, label }: { termId: string; label: string }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(activateTermAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="termId" value={termId} />
      <button type="submit" disabled={pending} className={buttonCls} aria-label={`เปิดใช้${label}`}>
        เปิดใช้ภาคเรียนนี้
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

/** BR-D1: closing is final for the term (read-only, off the public site, deleted one year later). */
export function CloseTermButton({ termId, label }: { termId: string; label: string }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(closeTermAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `ปิด${label}?\nภาคเรียนจะดูได้อย่างเดียว ไม่แสดงบนหน้าสาธารณะ และข้อมูลทั้งหมดจะถูกลบเมื่อครบ 1 ปี`,
          )
        )
          e.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="termId" value={termId} />
      <button type="submit" disabled={pending} className={buttonCls} aria-label={`ปิด${label}`}>
        ปิดภาคเรียน
      </button>
      <ActionMessage state={state} />
    </form>
  );
}
