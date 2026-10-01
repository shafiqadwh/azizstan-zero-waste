'use client';

import { Plus } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';
import { ActionMessage, Card, inputCls, primaryCls, buttonCls, type MessageState } from '@/components/app/settings';
import { parseScore, toDisplay } from '@/lib/scoring/decimal';
import { perRoundMax, scalingNote, trimScore } from '@/lib/term/config';
import { saveScoringAction } from './actions';

export interface ComponentValue {
  id?: string;
  key: string;
  label: string;
  unit: 'class' | 'area';
  source: 'committee' | 'area_teacher';
  kind: 'score' | 'deduct';
  maxValue: string;
  enabled: boolean;
  requiresSignature: boolean;
}

const fmt = (v: string) => {
  try {
    return trimScore(toDisplay(parseScore(v)));
  } catch {
    return v;
  }
};
const safeSum = (list: { id: string; kind: 'score' | 'deduct'; maxValue: string; enabled: boolean }[]) => {
  try {
    return trimScore(toDisplay(perRoundMax(list)));
  } catch {
    return '–';
  }
};

export function ScoringForm({
  termId,
  areaLabel,
  initial,
  rounds,
  initialEqualMax,
  initialRoundMax,
  initialFinalMax,
  disabled,
}: {
  termId: string;
  areaLabel: string;
  initial: ComponentValue[];
  rounds: number[];
  initialEqualMax: boolean;
  initialRoundMax: { roundNo: number; key: string; maxValue: string }[];
  initialFinalMax: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(saveScoringAction, null);
  const [components, setComponents] = useState(initial.map((c) => ({ ...c, maxValue: fmt(c.maxValue) })));
  const [equalMax, setEqualMax] = useState(initialEqualMax);
  const [grid, setGrid] = useState(
    () => new Map(initialRoundMax.map((m) => [`${m.roundNo}|${m.key}`, fmt(m.maxValue)])),
  );
  const [finalMax, setFinalMax] = useState(fmt(initialFinalMax));

  const asLike = (list: ComponentValue[]) =>
    list.map((c) => ({ id: c.key, kind: c.kind, maxValue: c.maxValue, enabled: c.enabled }));
  const note = useMemo(() => {
    try {
      return scalingNote(asLike(components), finalMax);
    } catch {
      return null;
    }
  }, [components, finalMax]);
  const enabled = components.filter((c) => c.enabled);

  const update = (i: number, patch: Partial<ComponentValue>) =>
    setComponents((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const gridValue = (roundNo: number, c: ComponentValue) => grid.get(`${roundNo}|${c.key}`) ?? c.maxValue;
  const roundSum = (roundNo: number) =>
    safeSum(enabled.map((c) => ({ id: c.key, kind: c.kind, maxValue: gridValue(roundNo, c), enabled: true })));

  const payload = JSON.stringify({
    termId,
    finalMax,
    equalMax,
    components,
    roundMax: equalMax
      ? []
      : rounds.flatMap((r) => enabled.map((c) => ({ roundNo: r, key: c.key, maxValue: gridValue(r, c) }))),
  });

  return (
    <form action={action}>
      <input type="hidden" name="payload" value={payload} />
      <Card title="คะแนน" id="scoring">
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <caption className="sr-only">ส่วนคะแนน</caption>
              <thead className="bg-surface-muted text-[13px]">
                <tr>
                  <th className="px-2 py-2">ใช้</th>
                  <th className="px-2 py-2">ส่วนคะแนน</th>
                  <th className="px-2 py-2">ผู้ให้คะแนน</th>
                  <th className="px-2 py-2">ประเภท</th>
                  <th className="px-2 py-2">คะแนนเต็ม</th>
                </tr>
              </thead>
              <tbody>
                {components.map((c, i) => (
                  <tr key={c.key} className={`border-b border-line ${c.enabled ? '' : 'text-ink-muted'}`}>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`ใช้${c.label}`}
                        checked={c.enabled}
                        onChange={(e) => update(i, { enabled: e.target.checked })}
                        className="size-5 accent-[var(--brand)]"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label="ชื่อส่วนคะแนน"
                        value={c.label}
                        onChange={(e) => update(i, { label: e.target.value })}
                        className={inputCls}
                      />
                      {c.unit === 'area' && c.source === 'committee' ? (
                        <span className="text-[12px] text-ink-muted">ประเมิน{areaLabel}</span>
                      ) : null}
                      {!c.enabled ? <span className="block text-[12px]">ไม่ใช้ในเทอมนี้</span> : null}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`ผู้ให้${c.label}`}
                        value={c.source}
                        onChange={(e) => update(i, { source: e.target.value as ComponentValue['source'] })}
                        className={inputCls}
                      >
                        <option value="committee">กรรมการ</option>
                        <option value="area_teacher">ครูผู้รับผิดชอบ</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`ประเภท${c.label}`}
                        value={c.kind}
                        onChange={(e) => update(i, { kind: e.target.value as ComponentValue['kind'] })}
                        className={inputCls}
                      >
                        <option value="score">ให้คะแนน</option>
                        <option value="deduct">หักคะแนน</option>
                      </select>
                    </td>
                    <td className="w-[110px] px-2 py-2">
                      <input
                        aria-label={`คะแนนเต็ม${c.label}`}
                        inputMode="decimal"
                        value={c.maxValue}
                        onChange={(e) => update(i, { maxValue: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() =>
              setComponents((list) => [
                ...list,
                {
                  key: `custom_${list.length + 1}`,
                  label: 'ส่วนคะแนนใหม่',
                  unit: 'class',
                  source: 'committee',
                  kind: 'score',
                  maxValue: '1',
                  enabled: true,
                  requiresSignature: false,
                },
              ])
            }
            className={`${buttonCls} inline-flex w-fit items-center gap-1.5`}
          >
            <Plus size={16} aria-hidden /> เพิ่มส่วนคะแนน
          </button>

          <p className="text-[15px] font-semibold" data-testid="per-round-sum">
            รวมต่อรอบ {safeSum(asLike(components))} คะแนน
          </p>

          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              role="switch"
              checked={equalMax}
              onChange={(e) => setEqualMax(e.target.checked)}
              className="size-5 accent-[var(--brand)]"
            />
            ใช้คะแนนเต็มเท่ากันทุกรอบ
          </label>
          {!equalMax ? (
            <div className="overflow-x-auto">
              <table className="text-[14px]">
                <caption className="mb-2 text-left text-[13px] text-ink-muted">คะแนนเต็มของแต่ละรอบ</caption>
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left">รอบ</th>
                    {enabled.map((c) => (
                      <th key={c.key} className="px-2 py-1 text-left">
                        {c.label}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-left">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r) => (
                    <tr key={r}>
                      <th className="px-2 py-1 text-left font-medium">รอบที่ {r}</th>
                      {enabled.map((c) => (
                        <td key={c.key} className="w-[110px] px-2 py-1">
                          <input
                            aria-label={`คะแนนเต็ม${c.label} รอบที่ ${r}`}
                            inputMode="decimal"
                            value={gridValue(r, c)}
                            onChange={(e) => setGrid((g) => new Map(g).set(`${r}|${c.key}`, e.target.value))}
                            className={inputCls}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 font-semibold">{roundSum(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-[180px] flex-col gap-1">
              <label htmlFor="final-max" className="text-[13px] font-semibold">
                คะแนนเต็มปลายภาคเรียน
              </label>
              <input
                id="final-max"
                inputMode="decimal"
                value={finalMax}
                onChange={(e) => setFinalMax(e.target.value)}
                className={inputCls}
              />
            </div>
            {note ? (
              <p className="pb-3 text-[14px] text-warn-ink" data-testid="scaling-note">
                {note}
              </p>
            ) : null}
          </div>
        </fieldset>
        {!disabled ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className={primaryCls}>
              บันทึกส่วนคะแนน
            </button>
            <ActionMessage state={state} />
          </div>
        ) : null}
      </Card>
    </form>
  );
}
