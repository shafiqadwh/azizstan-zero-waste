import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'งานของฉัน · AZIZSTAN ZERO WASTE' };

/** Placeholder until the task list (T17). */
export default function TasksPage() {
  return (
    <main className="mx-auto max-w-[720px] px-5 py-8">
      <h1 className="text-[20px] leading-[1.3] font-bold">งานของฉัน</h1>
      <p className="mt-2 text-ink-muted">รายการห้องที่ต้องประเมินจะแสดงที่นี่</p>
    </main>
  );
}
