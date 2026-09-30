import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SignedInHeader } from '@/components/app/SignedInHeader';
import { requirePageUser } from '@/server/auth/current-user';
import { homeFor } from '@/server/auth/redirects';
import { isStaffRole } from '@/server/policies';

/** 06-auth §4 rule 3: admin area = super admin, admin, executive (executives read-only). Others go to their home. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser('/admin');
  if (!isStaffRole(user.role)) redirect(homeFor(user.role));
  return (
    <>
      <SignedInHeader user={user} />
      {children}
    </>
  );
}
