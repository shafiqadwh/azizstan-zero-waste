import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/server/auth/current-user';

export const metadata: Metadata = { title: 'แดชบอร์ด · AZIZSTAN ZERO WASTE' };

/** Placeholder until the admin dashboard (T21). */
export default async function AdminHomePage() {
  const user = await getCurrentUser();
  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 lg:px-12">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">แดชบอร์ด</h1>
      <p className="mt-2 text-ink-muted">สวัสดี {user?.displayName} · หน้าแดชบอร์ดจะเปิดใช้เร็ว ๆ นี้</p>
      <nav aria-label="ตั้งค่า" className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/admin/settings/users"
          className="inline-flex h-11 items-center rounded-md border border-line-strong bg-surface px-4 font-medium hover:bg-surface-muted"
        >
          ผู้ใช้และสิทธิ์
        </Link>
        <Link
          href="/admin/settings/classes"
          className="inline-flex h-11 items-center rounded-md border border-line-strong bg-surface px-4 font-medium hover:bg-surface-muted"
        >
          ห้องเรียน อาคาร และหมายเลขห้อง
        </Link>
      </nav>
    </main>
  );
}
