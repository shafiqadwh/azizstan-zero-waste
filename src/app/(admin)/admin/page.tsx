import type { Metadata } from 'next';
import { getCurrentUser } from '@/server/auth/current-user';

export const metadata: Metadata = { title: 'แดชบอร์ด · AZIZSTAN ZERO WASTE' };

/** Placeholder until the admin dashboard (T21). */
export default async function AdminHomePage() {
  const user = await getCurrentUser();
  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 lg:px-12">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">แดชบอร์ด</h1>
      <p className="text-ink-muted mt-2">สวัสดี {user?.displayName} · หน้าแดชบอร์ดจะเปิดใช้เร็ว ๆ นี้</p>
    </main>
  );
}
