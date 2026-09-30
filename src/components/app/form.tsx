'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';
import { cn } from '@/lib/utils';

/** Labelled input with an error line (announced by screen readers). 16 px text stops iOS zoom. */
export function Field({
  label,
  error,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-[14px] font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'border-line-strong bg-surface text-ink focus-visible:ring-brand aria-invalid:border-danger h-12 rounded-md border px-3.5 text-[16px] outline-none focus-visible:ring-2',
          className,
        )}
        {...input}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-danger-ink text-[13px]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Password input with a show/hide toggle (08-ux-ui §6.6). */
export function PasswordField({
  label,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-[14px] font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="border-line-strong bg-surface text-ink focus-visible:ring-brand aria-invalid:border-danger h-12 w-full rounded-md border pr-12 pl-3.5 text-[16px] outline-none focus-visible:ring-2"
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          aria-pressed={visible}
          className="text-ink-muted hover:text-ink absolute inset-y-0 right-0 flex w-11 items-center justify-center"
        >
          {visible ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-danger-ink text-[13px]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, pendingLabel }: { children: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-brand hover:bg-brand-ink h-14 w-full rounded-md text-[16px] font-semibold text-white disabled:opacity-70"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Form-level error (not tied to one field). */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="bg-danger-soft text-danger-ink rounded-md px-3.5 py-3 text-[14px]">
      {message}
    </p>
  );
}
