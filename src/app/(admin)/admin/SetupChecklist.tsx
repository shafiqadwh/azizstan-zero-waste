import Link from 'next/link';
import { ChevronRight, CircleCheck, Circle } from 'lucide-react';
import type { SetupStep } from '@/server/services/setup.service';

/** First-day setup (14-deployment §2 step 7): shown on /admin until every step has data. */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section
      aria-labelledby="setup-title"
      className="rounded-[18px] border border-line bg-surface p-4"
      data-testid="setup-checklist"
    >
      <h2 id="setup-title" className="text-[17px] font-bold">
        ตั้งค่าเริ่มต้น {done}/{steps.length}
      </h2>
      <p className="mb-3 text-[14px] text-ink-muted">ทำตามลำดับ รายการนี้จะหายไปเมื่อตั้งค่าครบทุกขั้น</p>
      <ol className="grid gap-2 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className="flex min-h-12 items-center gap-3 rounded-[12px] border border-line px-3 py-2 hover:bg-surface-muted"
              data-testid={`setup-${s.key}`}
              data-done={s.done}
            >
              {s.done ? (
                <CircleCheck size={22} aria-label="เสร็จแล้ว" className="shrink-0 text-brand-ink" />
              ) : (
                <Circle size={22} aria-label="ยังไม่เสร็จ" className="shrink-0 text-ink-muted" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">
                  {i + 1}. {s.label}
                </span>
                <span className="block text-[13px] text-ink-muted">{s.detail}</span>
              </span>
              <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
