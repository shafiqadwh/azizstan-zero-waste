import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/app/AuthCard';
import { getCurrentUser } from '@/server/auth/current-user';
import { afterLogin, safeNext } from '@/server/auth/redirects';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'เข้าสู่ระบบ · AZIZSTAN ZERO WASTE' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next) ?? '';
  const user = await getCurrentUser();
  if (user) redirect(afterLogin(user, next));
  return (
    <AuthCard title="เข้าสู่ระบบ">
      <LoginForm next={next} />
    </AuthCard>
  );
}
