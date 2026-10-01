import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, ReadOnlyBanner } from '@/components/app/settings';
import { formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { listGuideForAdmin, listOrdersForAdmin } from '@/server/services/content.service';
import { GuideEditor, type GuideDraft } from './GuideEditor';
import { DeleteButton, OrderUpload } from './OrderUpload';

export const metadata: Metadata = { title: 'หน้าสาธารณะ · AZIZSTAN ZERO WASTE' };

const AUDIENCE: Record<string, string> = { public: 'ทุกคน', committee: 'กรรมการ', admin: 'ผู้ดูแล' };

/** Public content (08-ux-ui §6.20 "หน้าสาธารณะ"): appointment orders and guide pages. */
export default async function ContentPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await requirePageUser('/admin/settings/content');
  const edit = (await searchParams).edit;
  const db = getDb();
  const [orders, guide] = await Promise.all([listOrdersForAdmin(db, user), listGuideForAdmin(db, user)]);
  const canManage = can(user, 'content.manage');
  const editing: GuideDraft | null =
    edit === 'new'
      ? { slug: '', title: '', bodyMd: '', audience: 'public', sortOrder: guide.length }
      : (guide.find((g) => g.id === edit) ?? null);
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <Link href="/admin" className="text-[14px] text-brand-ink underline">
          ← ภาพรวม
        </Link>
        <h1 className="mt-2 text-[20px] leading-[1.3] font-bold lg:text-[26px]">หน้าสาธารณะ</h1>
      </div>
      {!canManage ? <ReadOnlyBanner /> : null}

      <Card title="คำสั่งแต่งตั้ง" id="orders-title">
        {canManage ? <OrderUpload /> : null}
        {orders.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-muted">ยังไม่มีคำสั่งแต่งตั้งในภาคเรียนนี้</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                <a href={`/api/v1/orders/${o.id}`} target="_blank" rel="noreferrer" className="underline">
                  {o.title}
                </a>
                <span className="flex items-center gap-3 text-[13px] text-ink-muted">
                  {formatThaiDateTime(o.createdAt)}
                  {canManage ? <DeleteButton id={o.id} kind="order" /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="คู่มือการใช้งาน" id="guide-title">
        <ul className="flex flex-col divide-y divide-line">
          {guide.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-semibold">{g.title}</span>
                <span className="ml-2 text-[13px] text-ink-muted">
                  /guide/{g.slug} · {AUDIENCE[g.audience] ?? g.audience}
                </span>
              </span>
              {canManage ? (
                <span className="flex gap-2">
                  <Link href={`/admin/settings/content?edit=${g.id}`} className="underline">
                    แก้ไข
                  </Link>
                  <DeleteButton id={g.id} kind="guide" />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          editing ? (
            <div className="mt-4 border-t border-line pt-4">
              <GuideEditor key={editing.id ?? 'new'} page={editing} />
            </div>
          ) : (
            <Link
              href="/admin/settings/content?edit=new"
              className="mt-3 inline-block font-semibold text-brand-ink underline"
            >
              + เพิ่มหน้าคู่มือ
            </Link>
          )
        ) : null}
      </Card>
    </main>
  );
}
