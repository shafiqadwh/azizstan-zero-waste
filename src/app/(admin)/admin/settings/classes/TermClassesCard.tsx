'use client';

import { TriangleAlert } from 'lucide-react';
import { useActionState, useState } from 'react';
import { saveTermClassesAction, type ActionState } from './actions';
import { ActionMessage, primaryClass } from './ui';

export interface TermClassItem {
  id: string;
  displayName: string;
  rankGroup: string;
  isActive: boolean;
}

/**
 * 08-ux-ui §6.14 "ห้องเรียนที่ใช้ในภาคเรียนนี้" (FR-P7) and the building (or zone) of each class (FR-P4): a round
 * freezes it when it opens, and the class shares that area's score.
 */
export function TermClassesCard({
  termId,
  termLabel,
  classes,
  selected,
  areaByClass,
  areaKind,
  areas,
  readOnly,
  lockedNote,
}: {
  termId: string;
  termLabel: string;
  classes: TermClassItem[];
  selected: string[];
  /** saved building (or zone) of each class this term */
  areaByClass: Record<string, string>;
  areaKind: 'อาคาร' | 'โซน';
  areas: { id: string; name: string }[];
  readOnly: boolean;
  lockedNote: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTermClassesAction, null);
  const [chosen, setChosen] = useState(() => new Set(selected));
  const groups = [...new Set(classes.map((c) => c.rankGroup))];
  const noArea = [...chosen].filter((id) => !areaByClass[id]).length;
  const toggle = (ids: string[], on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <section aria-labelledby="term-classes" className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="term-classes" className="text-[17px] font-bold">
          ห้องเรียนที่ใช้ใน{termLabel}
        </h2>
        <p className="text-[14px] text-ink-muted" data-testid="term-class-count">
          ใช้ {chosen.size} จาก {classes.length} ห้อง
        </p>
      </div>
      {selected.length === 0 ? (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-[14px] text-warn-ink">
          <TriangleAlert size={16} aria-hidden /> ยังไม่ได้เลือกห้องเรียนที่ใช้
        </p>
      ) : null}
      {selected.length > 0 && noArea > 0 ? (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-[14px] text-warn-ink">
          <TriangleAlert size={16} aria-hidden /> ยังไม่ได้เลือก{areaKind} {noArea} ห้องเรียน · ห้องเรียนที่ไม่มี
          {areaKind}
          จะไม่ได้คะแนน{areaKind}
        </p>
      ) : null}
      {areas.length === 0 ? (
        <p className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-[14px]">
          ยังไม่มี{areaKind} · เพิ่ม{areaKind}ก่อนแล้วจึงเลือก{areaKind}ให้ห้องเรียน
        </p>
      ) : null}
      {lockedNote ? <p className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-[14px]">{lockedNote}</p> : null}
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="termId" value={termId} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const items = classes.filter((c) => c.rankGroup === group);
            const ids = items.map((c) => c.id);
            return (
              <fieldset key={group} className="rounded-lg border border-line p-3">
                <legend className="px-1 text-[14px] font-semibold">{group}</legend>
                {!readOnly ? (
                  <div className="mb-2 flex gap-3 text-[13px]">
                    <button type="button" className="underline" onClick={() => toggle(ids, true)}>
                      เลือกทั้งหมด
                    </button>
                    <button type="button" className="underline" onClick={() => toggle(ids, false)}>
                      ไม่เลือกทั้งหมด
                    </button>
                  </div>
                ) : null}
                <ul className="flex flex-col">
                  {items.map((c) => {
                    const on = chosen.has(c.id);
                    return (
                      <li key={c.id}>
                        <label className={`flex min-h-11 items-center gap-2 ${on ? '' : 'text-ink-muted'}`}>
                          <input
                            type="checkbox"
                            name="classId"
                            value={c.id}
                            checked={on}
                            disabled={readOnly}
                            onChange={(e) => toggle([c.id], e.target.checked)}
                            className="size-5 accent-[var(--brand)]"
                          />
                          <span>{c.displayName}</span>
                          {!on ? <span className="text-[12px]">· ไม่ใช้ในภาคเรียนนี้</span> : null}
                        </label>
                        {on && areas.length > 0 ? (
                          <select
                            name={`area:${c.id}`}
                            aria-label={`${areaKind}ของ ${c.displayName}`}
                            defaultValue={areaByClass[c.id] ?? ''}
                            disabled={readOnly}
                            className="mb-2 ml-7 h-10 w-[calc(100%-1.75rem)] rounded-md border border-line-strong bg-surface px-2 text-[15px]"
                          >
                            <option value="">— เลือก{areaKind} —</option>
                            {areas.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className={primaryClass}>
              บันทึกห้องเรียนที่ใช้
            </button>
            <ActionMessage state={state} />
          </div>
        ) : null}
      </form>
    </section>
  );
}
