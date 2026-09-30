import type { Metadata } from 'next';
import { AuthCard } from '@/components/app/AuthCard';
import { requirePageUser } from '@/server/auth/current-user';
import { homeFor, safeNext } from '@/server/auth/redirects';
import { PasswordForm } from './PasswordForm';

export const metadata: Metadata = { title: 'เปลี่ยนรหัสผ่าน · AZIZSTAN ZERO WASTE' };

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await requirePageUser('/account/password', { allowMustChange: true });
  const redirectTo = safeNext((await searchParams).next) ?? homeFor(user.role);
  return (
    <AuthCard title="เปลี่ยนรหัสผ่าน">
      {user.mustChangePassword ? (
        <p className="mb-4 rounded-md bg-warn-soft px-3.5 py-3 text-[14px] text-warn-ink">
          กรุณาตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน (อย่างน้อย 8 ตัวอักษร)
        </p>
      ) : null}
      <PasswordForm redirectTo={redirectTo} />
    </AuthCard>
  );
}
