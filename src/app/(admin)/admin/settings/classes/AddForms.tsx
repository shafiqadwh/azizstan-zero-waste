'use client';

import { useActionState } from 'react';
import { addBuildingAction, addClassAction, type ActionState } from './actions';
import { ActionMessage, buttonClass, inputClass, Labelled, primaryClass } from './ui';

export function AddClassForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addClassAction, null);
  return (
    <form action={action} key={state?.ok ? state.seq : 'add-class'} className="grid gap-3 md:grid-cols-3">
      <Labelled label="สาย" htmlFor="c-track">
        <select id="c-track" name="track" defaultValue="general" className={inputClass}>
          <option value="general">สามัญ</option>
          <option value="religious">ศาสนา</option>
          <option value="vocational">อาชีพ</option>
        </select>
      </Labelled>
      <Labelled label="รหัสระดับชั้น" htmlFor="c-grade-code">
        <input id="c-grade-code" name="gradeCode" placeholder="M1, VOC2, REL-SAN2" required className={inputClass} />
      </Labelled>
      <Labelled label="ระดับชั้น" htmlFor="c-grade-label">
        <input
          id="c-grade-label"
          name="gradeLabel"
          placeholder="ม.1, ปวช.2, ซานาวี ปี 2"
          required
          className={inputClass}
        />
      </Labelled>
      <Labelled label="กลุ่มจัดอันดับ" htmlFor="c-rank">
        <input id="c-rank" name="rankGroup" placeholder="ม.1, ปวช., ซานาวี" required className={inputClass} />
      </Labelled>
      <Labelled label="ชื่อห้องเรียน" htmlFor="c-name">
        <input id="c-name" name="name" placeholder="Amanah" required className={inputClass} />
      </Labelled>
      <Labelled label="ลำดับ (ใช้เรียงเท่านั้น)" htmlFor="c-roomno">
        <input id="c-roomno" name="roomNo" type="number" min={0} max={99} defaultValue={1} className={inputClass} />
      </Labelled>
      <div className="flex flex-wrap items-center gap-3 md:col-span-3">
        <button type="submit" disabled={pending} className={primaryClass}>
          เพิ่มห้องเรียน
        </button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

export function AddBuildingForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addBuildingAction, null);
  return (
    <form action={action} key={state?.ok ? state.seq : 'add-building'} className="flex flex-wrap items-end gap-2">
      <div className="w-[120px]">
        <Labelled label="รหัสอาคาร" htmlFor="b-code">
          <input id="b-code" name="code" required className={inputClass} placeholder="9" />
        </Labelled>
      </div>
      <div className="min-w-[160px] flex-1">
        <Labelled label="ชื่ออาคาร" htmlFor="b-name">
          <input id="b-name" name="name" className={inputClass} placeholder="อาคาร 9" />
        </Labelled>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        + เพิ่มอาคาร
      </button>
      <div className="w-full">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}
