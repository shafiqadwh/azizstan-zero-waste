import type { ReactNode } from 'react';
import { Logo } from './Logo';

/** Centered card used by login and password pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-5 py-10 md:items-center">
      <div className="w-full max-w-[400px] rounded-xl border border-line bg-surface p-6 md:p-8">
        <p className="mb-6 text-[20px]">
          <Logo />
        </p>
        <h1 className="mb-5 text-[20px] leading-[1.3] font-bold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
