import type { ReactNode } from 'react';
import { SignedInHeader } from '@/components/app/SignedInHeader';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { isStaffRole } from '@/server/policies';
import { hasDutyInActiveTerm } from '@/server/repositories/duties.repository';

/**
 * 06-auth §4 rule 3: committee area = any active duty in the active term, or admin/executive.
 * Without either, the page explains why instead of failing (08-ux-ui §9 empty.tasks).
 */
export default async function CommitteeLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser('/tasks');
  const allowed = isStaffRole(user.role) || (await hasDutyInActiveTerm(getDb(), user.id, new Date()));
  return (
    <>
      <SignedInHeader user={user} />
      {allowed ? (
        children
      ) : (
        <main className="mx-auto max-w-[720px] px-5 py-10">
          <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center text-ink">
            คุณยังไม่ได้รับมอบหมายให้ประเมินในเทอมนี้
          </p>
        </main>
      )}
    </>
  );
}
