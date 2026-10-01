'use client';

import { Check, Lock } from 'lucide-react';
import type { ReactNode } from 'react';

export type MessageState = (
  { ok: true; data: { message: string } } | { ok: false; error: { message: string; field?: string } }
) & {
  seq: number;
};

export const inputCls =
  'h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:bg-surface-muted disabled:text-ink-muted';
export const buttonCls =
  'h-11 shrink-0 rounded-md border border-line-strong bg-surface px-3 text-[14px] font-medium text-ink hover:bg-surface-muted disabled:opacity-60';
export const primaryCls =
  'h-12 shrink-0 rounded-md bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-ink disabled:opacity-60';

export function ActionMessage({ state }: { state: MessageState | null }) {
  if (!state) return null;
  if (state.ok)
    return (
      <p role="status" className="flex items-center gap-1 text-[14px] text-brand-ink">
        <Check size={16} aria-hidden /> {state.data.message}
      </p>
    );
  return (
    <p role="alert" className="text-[14px] text-danger-ink">
      {state.error.message}
    </p>
  );
}

export function Card({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line bg-surface p-5">
      <h2 id={id} className="mb-4 text-[17px] font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 08-ux-ui §6.12: locked term → every control disabled + this banner. */
export function LockedBanner() {
  return (
    <p role="note" className="flex items-center gap-2 rounded-md bg-warn-soft px-4 py-3 text-[14px] text-warn-ink">
      <Lock size={16} aria-hidden /> เทอมนี้มีผลประเมินแล้ว การตั้งค่าถูกล็อก
    </p>
  );
}

export function ReadOnlyBanner() {
  return (
    <p role="note" className="rounded-md bg-surface-muted px-4 py-3 text-[14px]">
      โหมดดูอย่างเดียว
    </p>
  );
}
