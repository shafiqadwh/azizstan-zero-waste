'use client';

import { useId, useState } from 'react';
import { mean, parseScore, toDisplay, type Th } from '@/lib/scoring/decimal';
import { trimScore } from '@/lib/term/config';

const show = (th: Th) => trimScore(toDisplay(th));
/** Up to this many choices a native select is quicker than typing; beyond it the field takes a number. */
const MAX_CHOICES = 41;

export interface StudentRow {
  id: string;
  code: string;
}

/** Every allowed value 0, step, 2·step … max, or null when there are too many for a list. */
export function scoreChoices(max: Th, step: Th): Th[] | null {
  if (step <= 0) return null;
  const n = Math.floor(max / step) + 1;
  if (n > MAX_CHOICES) return null;
  return Array.from({ length: n }, (_, i) => i * step);
}

/** "4.5" → 4500; empty → null; anything unparsable → undefined (left for validation to explain). */
export function parseTyped(raw: string): Th | null | undefined {
  const s = raw.trim();
  if (s === '') return null;
  try {
    return parseScore(s);
  } catch {
    return undefined;
  }
}

function TypedScore({
  value,
  label,
  onChange,
  invalid,
}: {
  value: Th | null;
  label: string;
  onChange: (v: Th | null) => void;
  invalid?: boolean;
}) {
  // while focused the field shows what is typed; otherwise the stored value (so "ใส่ให้คนที่ยังว่าง" shows up)
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const shown = value === null ? '' : show(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || bad || undefined}
      value={text ?? shown}
      onFocus={() => setText(shown)}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseTyped(e.target.value);
        setBad(v === undefined);
        if (v !== undefined) onChange(v);
      }}
      className="h-11 w-20 rounded-md border border-line-strong bg-surface px-2 text-right text-[16px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand"
    />
  );
}

/**
 * Individual mode (FR-R6, T40): one score per snapshot student, listed by **student code only** — names are never
 * shown (FR-S1). Shows how many are filled and the live class mean (the value used for ranking, BR-S2), and fills
 * every empty row with one value for the common case "ทั้งห้องได้เท่ากันยกเว้นบางคน".
 */
export function StudentScoreList({
  students,
  max,
  step,
  values,
  onChange,
  onFillEmpty,
  invalid,
  describedBy,
}: {
  students: StudentRow[];
  max: Th;
  step: Th;
  values: Readonly<Record<string, Th | null>>;
  onChange: (studentId: string, value: Th | null) => void;
  onFillEmpty: (value: Th) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const uid = useId();
  const choices = scoreChoices(max, step);
  const [fill, setFill] = useState<Th | null>(null);
  const filled = students.map((s) => values[s.id]).filter((v): v is Th => v !== null && v !== undefined);
  const avg = mean(filled);
  const empty = students.length - filled.length;

  return (
    <div className="flex flex-col gap-3" aria-describedby={describedBy}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
        <span data-testid="students-filled">
          ใส่แล้ว {filled.length} / {students.length} คน
        </span>
        <span className="text-ink-muted">
          เฉลี่ยห้อง <strong className="text-ink tabular-nums">{avg === null ? '–' : show(avg)}</strong>
        </span>
      </div>

      {empty > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2">
          <label htmlFor={`${uid}-fill`} className="text-[14px]">
            ใส่ให้คนที่ยังว่าง
          </label>
          {choices ? (
            <select
              id={`${uid}-fill`}
              value={fill ?? ''}
              onChange={(e) => setFill(e.target.value === '' ? null : Number(e.target.value))}
              className="h-11 rounded-md border border-line-strong bg-surface px-2 text-[16px]"
            >
              <option value="">–</option>
              {choices.map((c) => (
                <option key={c} value={c}>
                  {show(c)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${uid}-fill`}
              type="text"
              inputMode="decimal"
              onChange={(e) => setFill(parseTyped(e.target.value) ?? null)}
              className="h-11 w-20 rounded-md border border-line-strong bg-surface px-2 text-right text-[16px]"
            />
          )}
          <button
            type="button"
            disabled={fill === null}
            onClick={() => fill !== null && onFillEmpty(fill)}
            className="h-11 rounded-md border border-brand px-3 text-[14px] font-semibold text-brand-ink disabled:opacity-50"
          >
            ใส่ {empty} คน
          </button>
        </div>
      ) : null}

      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2" aria-label="คะแนนรายคน">
        {students.map((s, i) => {
          const v = values[s.id] ?? null;
          const label = `คะแนนนักเรียนรหัส ${s.code}`;
          return (
            <li
              key={s.id}
              className={`flex items-center justify-between gap-3 border-b border-line py-1.5 ${
                invalid && v === null ? 'bg-danger-soft/60' : ''
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="w-6 text-right text-[13px] text-ink-muted tabular-nums">{i + 1}</span>
                <span className="text-[16px] tabular-nums">{s.code}</span>
              </span>
              {choices ? (
                <select
                  aria-label={label}
                  aria-invalid={(invalid && v === null) || undefined}
                  value={v ?? ''}
                  onChange={(e) => onChange(s.id, e.target.value === '' ? null : Number(e.target.value))}
                  className="h-11 w-20 rounded-md border border-line-strong bg-surface px-2 text-right text-[16px] tabular-nums"
                >
                  <option value="">–</option>
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {show(c)}
                    </option>
                  ))}
                </select>
              ) : (
                <TypedScore
                  value={v}
                  label={label}
                  invalid={invalid && v === null}
                  onChange={(nv) => onChange(s.id, nv)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
