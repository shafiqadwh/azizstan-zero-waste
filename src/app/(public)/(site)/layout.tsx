import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/app/Logo';

const NAV = [
  ['/rankings', 'จัดอันดับ'],
  ['/classes', 'ห้องเรียน'],
  ['/areas', 'อาคาร/โซน'],
  ['/orders', 'คำสั่งแต่งตั้ง'],
  ['/guide', 'วิธีใช้งาน'],
] as const;

/** 08-ux-ui §5 public shell: header (wordmark, nav on desktop, "เข้าสู่ระบบ" pill), content, footer. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-5 py-3 lg:px-12">
          <Link href="/" className="text-[17px]">
            <Logo />
          </Link>
          <nav aria-label="เมนูหลัก" className="hidden gap-1 lg:flex">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="rounded-md px-3 py-2 text-[15px] hover:bg-surface-muted">
                {label}
              </Link>
            ))}
          </nav>
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-full border border-line-strong px-4 text-[14px] font-medium"
          >
            เข้าสู่ระบบ
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1180px] px-5 py-6 text-[13px] text-ink-muted lg:px-12">
          โรงเรียนมูลนิธิอาซิซสถาน · โครงการ AZIZSTAN ZERO WASTE
        </div>
      </footer>
    </div>
  );
}
