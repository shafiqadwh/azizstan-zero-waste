'use client';

import { useActionState, useState } from 'react';
import { ActionMessage, Card, inputCls, primaryCls, type MessageState } from '@/components/app/settings';
import { saveModeAction } from './actions';

export interface ModeValues {
  termId: string;
  areaType: 'zone' | 'building';
  roomMode: 'group' | 'individual';
  areaMode: 'group' | 'individual';
  scoreFormat: 'integer' | 'decimal';
  scoreStep: string;
  finalMax: string;
  photoMin: number;
  photoMax: number;
  commentMax: number;
  selfEditHours: number;
  lateEntryDefaultHours: number;
}

/** Radio group rendered as cards / segmented buttons: real radios, labels, arrow keys work natively. */
function Choice<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  legend: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange?: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-[14px] font-semibold">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-line-strong p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === value}
              onChange={() => onChange?.(o.value)}
              className="mt-1 size-4 accent-[var(--brand)]"
            />
            <span>
              <span className="block font-medium">{o.label}</span>
              {o.hint ? <span className="block text-[13px] text-ink-muted">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({
  label,
  name,
  value,
  min,
  max,
  disabled,
}: {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`f-${name}`} className="text-[13px] font-semibold">
        {label}
      </label>
      <input
        id={`f-${name}`}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={value}
        disabled={disabled}
        required
        className={inputCls}
      />
    </div>
  );
}

export function ModeForm({ values, disabled }: { values: ModeValues; disabled: boolean }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(saveModeAction, null);
  const [format, setFormat] = useState(values.scoreFormat);
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="termId" value={values.termId} />
      <input type="hidden" name="finalMax" value={values.finalMax} />

      <Card title="รูปแบบคะแนน" id="format">
        <div className="flex flex-col gap-4">
          <Choice
            name="scoreFormat"
            legend="กรรมการให้คะแนนเป็น"
            value={values.scoreFormat}
            onChange={setFormat}
            disabled={disabled}
            options={[
              { value: 'integer', label: 'จำนวนเต็ม', hint: 'เช่น 0, 1, 2 … 5' },
              { value: 'decimal', label: 'ทศนิยม', hint: 'เลือกช่วงคะแนนได้ เช่น ทีละ 0.5' },
            ]}
          />
          {format === 'decimal' ? (
            <div className="flex max-w-[240px] flex-col gap-1">
              <label htmlFor="f-step" className="text-[13px] font-semibold">
                ให้คะแนนทีละ
              </label>
              <select
                id="f-step"
                name="scoreStep"
                defaultValue={values.scoreFormat === 'decimal' ? values.scoreStep : '0.500'}
                disabled={disabled}
                className={inputCls}
              >
                <option value="0.500">0.5</option>
                <option value="0.250">0.25</option>
                <option value="0.100">0.1</option>
              </select>
            </div>
          ) : null}
          <p className="text-[13px] text-ink-muted">
            คะแนนคำนวณละเอียด 3 ตำแหน่ง แสดงและส่งออก 2 ตำแหน่ง (ปัดครึ่งขึ้น)
          </p>
        </div>
      </Card>

      <Card title="วิธีประเมิน" id="method">
        <div className="flex flex-col gap-4">
          <Choice
            name="areaType"
            legend="พื้นที่ส่วนรวมประเมินเป็น"
            value={values.areaType}
            disabled={disabled}
            options={[
              { value: 'building', label: 'อาคาร' },
              { value: 'zone', label: 'โซน' },
            ]}
          />
          <Choice
            name="roomMode"
            legend="คะแนนห้องเรียน"
            value={values.roomMode}
            disabled={disabled}
            options={[
              { value: 'group', label: 'เหมารวม', hint: 'นักเรียนทุกคนในห้องได้คะแนนเดียวกัน' },
              { value: 'individual', label: 'รายคน' },
            ]}
          />
          <Choice
            name="areaMode"
            legend="คะแนนพื้นที่"
            value={values.areaMode}
            disabled={disabled}
            options={[
              { value: 'group', label: 'เหมารวม' },
              { value: 'individual', label: 'รายคน' },
            ]}
          />
        </div>
      </Card>

      <Card title="หลักฐานและการแก้ไข" id="evidence">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="รูปสถานที่ขั้นต่ำ"
            name="photoMin"
            value={values.photoMin}
            min={0}
            max={10}
            disabled={disabled}
          />
          <NumberField
            label="รูปสถานที่สูงสุด"
            name="photoMax"
            value={values.photoMax}
            min={1}
            max={10}
            disabled={disabled}
          />
          <NumberField
            label="ข้อติชมยาวสุด (ตัวอักษร)"
            name="commentMax"
            value={values.commentMax}
            min={0}
            max={2000}
            disabled={disabled}
          />
          <NumberField
            label="แก้ไขเองได้ภายใน (ชั่วโมง)"
            name="selfEditHours"
            value={values.selfEditHours}
            min={0}
            max={240}
            disabled={disabled}
          />
          <NumberField
            label="ใส่คะแนนย้อนหลังที่อนุมัติ (ชั่วโมง)"
            name="lateEntryDefaultHours"
            value={values.lateEntryDefaultHours}
            min={1}
            max={240}
            disabled={disabled}
          />
        </div>
      </Card>

      {!disabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={primaryCls}>
            บันทึกการตั้งค่า
          </button>
          <ActionMessage state={state} />
        </div>
      ) : null}
    </form>
  );
}
