import { FileText } from 'lucide-react';
import type { Metadata } from 'next';
import { publicOrders } from '@/server/public-cache';

export const metadata: Metadata = { title: 'คำสั่งแต่งตั้ง · AZIZSTAN ZERO WASTE' };
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const orders = await publicOrders();
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-6 lg:py-8">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">คำสั่งแต่งตั้ง</h1>
      {orders.length === 0 ? (
        <p className="rounded-[18px] border border-line bg-surface px-5 py-6">ยังไม่มีคำสั่งแต่งตั้งในภาคเรียนนี้</p>
      ) : (
        <ul className="rounded-[18px] border border-line bg-surface">
          {orders.map((o) => (
            <li key={o.id} className="border-b border-line last:border-b-0">
              <a href={o.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3">
                <FileText size={20} aria-hidden className="text-brand" />
                {o.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
