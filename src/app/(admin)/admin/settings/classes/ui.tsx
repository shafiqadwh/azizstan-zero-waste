'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ActionState } from './actions';

export const inputClass =
  'h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand';
export const buttonClass =
  'h-11 shrink-0 rounded-md border border-line-strong bg-surface px-3 text-[14px] font-medium text-ink hover:bg-surface-muted disabled:opacity-60';
export const primaryClass =
  'h-11 shrink-0 rounded-md bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-ink disabled:opacity-60';

/** Result line under a form: green on success, red on error (text, not colour alone). */
export function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.ok)
    return state.data.message ? (
      <p role="status" className="flex items-center gap-1 text-[13px] text-brand-ink">
        <Check size={14} aria-hidden /> {state.data.message}
      </p>
    ) : null;
  return (
    <p role="alert" className="text-[13px] text-danger-ink">
      {state.error.message}
    </p>
  );
}

export function Labelled({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
