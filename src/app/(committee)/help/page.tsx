import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { listHelpPages } from '@/server/services/content.service';

export const metadata: Metadata = { title: 'คู่มือ · AZIZSTAN ZERO WASTE' };

/** In-app manuals: committee pages for every signed-in user, admin pages for staff (edited at ตั้งค่า › เนื้อหา). */
export default async function HelpIndex() {
  const user = await requirePageUser('/help');
  const pages = await listHelpPages(getDb(), user);
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6">
      <h1 className="text-[20px] font-bold">คู่มือ</h1>
      {pages.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center">ยังไม่มีคู่มือ</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {pages.map((p) => (
            <li key={p.slug}>
              <Link href={`/help/${p.slug}`} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <span className="flex-1 font-semibold">{p.title}</span>
                {p.audience === 'admin' ? (
                  <span className="rounded-full border border-line-strong px-2 py-0.5 text-[12px]">ผู้ดูแล</span>
                ) : null}
                <ChevronRight size={18} aria-hidden className="text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[14px] text-ink-muted">
        คู่มือสำหรับทุกคน (ไม่ต้องเข้าสู่ระบบ) อยู่ที่{' '}
        <Link href="/guide" className="text-brand-ink underline">
          วิธีการใช้งาน
        </Link>
      </p>
    </main>
  );
}
