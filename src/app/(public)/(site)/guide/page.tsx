import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { publicGuide } from '@/server/public-cache';

export const metadata: Metadata = { title: 'วิธีการใช้งาน · AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

export default async function GuidePage() {
  const pages = await publicGuide();
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6 lg:py-8">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">วิธีการใช้งานเบื้องต้น</h1>
      {pages.length === 0 ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">ยังไม่มีคู่มือ</p>
      ) : (
        <ul className="rounded-[18px] border border-line bg-surface">
          {pages.map((g) => (
            <li key={g.slug} className="border-b border-line last:border-b-0">
              <Link href={`/guide/${g.slug}`} className="flex items-center justify-between px-4 py-3">
                {g.title}
                <ChevronRight size={18} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
