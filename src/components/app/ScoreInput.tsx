'use client';

import { Minus, Plus } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { toDisplay, type Th } from '@/lib/scoring/decimal';
import { trimScore } from '@/lib/term/config';

const show = (th: Th) => trimScore(toDisplay(th));

/**
 * 08-ux-ui §4.6: − value + with quick chips 0…max (max ≤ 10). Starts empty ("–"): 0 must be chosen (FR-E2).
 * Keyboard: ↑/↓ change by one step on the value (role spinbutton).
 */
export function ScoreInput({
  id,
  max,
  step,
  value,
  onChange,
  invalid,
  describedBy,
  noZero,
}: {
  id: string;
  max: Th;
  step: Th;
  value: Th | null;
  onChange: (v: Th) => void;
  invalid?: boolean;
  describedBy?: string;
  /** T41 deduction: 0 is not a choice (nothing to deduct means no deduction at all) */
  noZero?: boolean;
}) {
  const dec = () => onChange(value === null ? 0 : Math.max(0, value - step));
  const inc = () => onChange(value === null ? Math.min(step, max) : Math.min(max, value + step));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      inc();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      dec();
    }
  };
  const chips = (max <= 10_000 ? Array.from({ length: Math.floor(max / 1000) + 1 }, (_, i) => i * 1000) : []).filter(
    (c) => !noZero || c > 0,
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={dec}
          aria-label="ลดคะแนน"
          className="flex size-14 items-center justify-center rounded-full border border-line-strong bg-surface"
        >
          <Minus size={24} aria-hidden />
        </button>
        <div
          id={id}
          role="spinbutton"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={max / 1000}
          aria-valuenow={value === null ? undefined : value / 1000}
          aria-valuetext={value === null ? 'ยังไม่เลือก' : show(value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-label="คะแนน"
          onKeyDown={onKey}
          className="min-w-[96px] rounded-md text-center text-[52px] leading-none font-bold outline-none focus-visible:ring-2 focus-visible:ring-brand"
          data-testid="score-value"
        >
          {value === null ? '–' : show(value)}
        </div>
        <button
          type="button"
          onClick={inc}
          aria-label="เพิ่มคะแนน"
          className="flex size-14 items-center justify-center rounded-full bg-brand text-white"
        >
          <Plus size={24} aria-hidden />
        </button>
      </div>
      {chips.length > 0 ? (
        <div className="grid grid-cols-6 gap-2" role="group" aria-label="เลือกคะแนน">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              aria-pressed={value === c}
              className={`h-10 rounded-full border text-[15px] ${value === c ? 'border-brand bg-brand-soft font-semibold text-brand-ink' : 'border-line-strong bg-surface'}`}
            >
              {show(c)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
