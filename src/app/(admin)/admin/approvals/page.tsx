import type { Metadata } from 'next';
import Link from 'next/link';
import { ReadOnlyBanner } from '@/components/app/settings';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { findActiveTerm } from '@/server/repositories/places.repository';
import { listWaitingRequests } from '@/server/services/request.service';
import { RequestCardView } from './RequestCardView';

export const metadata: Metadata = { title: 'รออนุมัติ · AZIZSTAN ZERO WASTE' };

/** 08-ux-ui §6.11 — the "คำขอ" tab (results approval cards come with the dashboard, T23). */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser('/admin/approvals');
  const tab = (await searchParams).tab === 'results' ? 'results' : 'requests';
  const db = getDb();
  const [cards, term] = await Promise.all([listWaitingRequests(db, user), findActiveTerm(db)]);
  const canDecide = can(user, 'request.decide');
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-5 px-5 py-8 lg:px-12">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">รออนุมัติ</h1>
      <nav role="tablist" aria-label="ประเภท" className="flex w-fit rounded-[14px] bg-[#E9E7DF] p-1">
        <Link
          role="tab"
          aria-selected={tab === 'results'}
          href="/admin/approvals?tab=results"
          className={`rounded-[10px] px-4 py-2 text-[14px] ${tab === 'results' ? 'bg-surface font-semibold' : ''}`}
        >
          ผลประเมิน
        </Link>
        <Link
          role="tab"
          aria-selected={tab === 'requests'}
          href="/admin/approvals?tab=requests"
          className={`rounded-[10px] px-4 py-2 text-[14px] ${tab === 'requests' ? 'bg-surface font-semibold' : ''}`}
        >
          คำขอ {cards.length}
        </Link>
      </nav>
      {!canDecide ? <ReadOnlyBanner /> : null}
      {tab === 'results' ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6">หน้าอนุมัติผลประเมินจะเปิดใช้เร็ว ๆ นี้</p>
      ) : cards.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6">ไม่มีคำขอที่รออนุมัติ</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {cards.map((c) => (
            <RequestCardView
              key={c.id}
              card={c}
              canDecide={canDecide}
              defaultHours={term?.lateEntryDefaultHours ?? 24}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
