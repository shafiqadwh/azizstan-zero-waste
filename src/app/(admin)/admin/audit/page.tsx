import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { inputCls } from '@/components/app/settings';
import { formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { homeFor } from '@/server/auth/redirects';
import { getDb } from '@/server/db';
import { isStaffRole } from '@/server/policies';
import { getAuditLog } from '@/server/services/audit-log.service';

export const metadata: Metadata = { title: 'ประวัติการทำรายการ · AZIZSTAN ZERO WASTE' };

const ENTITY_LABEL: Record<string, string> = {
  user: 'ผู้ใช้',
  term: 'ภาคเรียน',
  round: 'รอบ',
  round_class_area: 'พื้นที่ของห้องในรอบ',
  evaluation: 'ผลประเมิน',
  evidence: 'รูปหลักฐาน',
  request: 'คำขอ',
  duty: 'หน้าที่กรรมการ',
  appointment_order: 'คำสั่งแต่งตั้ง',
  guide_page: 'หน้าคู่มือ',
  api_key: 'คีย์ API',
  area: 'อาคาร/โซน',
  physical_room: 'ห้อง',
  class_skip_rule: 'กฎข้ามห้องเรียน',
  import: 'นำเข้าไฟล์',
  sync: 'sync นักเรียน',
  retention: 'ลบข้อมูลตามกำหนด',
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** 12-security §2 item 8: append-only audit log, read-only for admins, executives and the super admin. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePageUser('/admin/audit');
  if (!isStaffRole(user.role)) redirect(homeFor(user.role));
  const sp = await searchParams;
  const raw = Object.fromEntries(Object.keys(sp).map((k) => [k, one(sp[k])]));
  const { query, rows, nextBefore, entities } = await getAuditLog(getDb(), user, raw);
  const next = new URLSearchParams(
    Object.entries({ ...query, before: nextBefore ?? undefined })
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  );

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <Link href="/admin" className="text-[14px] text-brand-ink underline">
          ← ภาพรวม
        </Link>
        <h1 className="mt-2 text-[20px] leading-[1.3] font-bold lg:text-[26px]">ประวัติการทำรายการ</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          บันทึกทุกการเปลี่ยนแปลงในระบบ แก้ไขหรือลบไม่ได้ · ข้อมูลของภาคเรียนถูกลบพร้อมภาคเรียนเมื่อครบกำหนด
        </p>
      </div>

      <form
        method="get"
        className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-3 lg:grid-cols-6"
      >
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          ประเภท
          <select name="entity" defaultValue={query.entity ?? ''} className={inputCls}>
            <option value="">ทั้งหมด</option>
            {entities.map((e) => (
              <option key={e} value={e}>
                {ENTITY_LABEL[e] ?? e}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          รายการ
          <input name="action" defaultValue={query.action ?? ''} placeholder="เช่น approve" className={inputCls} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          ผู้ทำรายการ
          <input
            name="actor"
            defaultValue={query.actor ?? ''}
            placeholder="ชื่อผู้ใช้ หรือ system"
            className={inputCls}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          รหัสรายการ
          <input name="id" defaultValue={query.id ?? ''} className={inputCls} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          ตั้งแต่วันที่
          <input type="date" name="from" defaultValue={query.from ?? ''} className={inputCls} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
          ถึงวันที่
          <input type="date" name="to" defaultValue={query.to ?? ''} className={inputCls} />
        </label>
        <div className="flex gap-2 md:col-span-3 lg:col-span-6">
          <button type="submit" className="h-11 rounded-md bg-brand px-5 text-[15px] font-semibold text-white">
            ค้นหา
          </button>
          <Link
            href="/admin/audit"
            className="inline-flex h-11 items-center rounded-md border border-line-strong px-4 text-[14px]"
          >
            ล้างตัวกรอง
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center">ไม่พบรายการ</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="audit-rows">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-3 text-[14px]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-mono font-semibold">{r.action}</span>
                <span className="text-ink-muted">{formatThaiDateTime(r.at)}</span>
              </div>
              <p className="mt-1 break-all text-ink-muted">
                {ENTITY_LABEL[r.entity] ?? r.entity} · <span className="font-mono">{r.entityId}</span> · {r.actor}
                {r.ip ? ` · ${r.ip}` : ''}
              </p>
              {r.before !== null || r.after !== null ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-brand-ink">รายละเอียด</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface-muted p-2 text-[12px] whitespace-pre-wrap">
                    {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {nextBefore ? (
        <Link href={`/admin/audit?${next}`} className="self-start text-[14px] font-semibold text-brand-ink underline">
          รายการก่อนหน้า →
        </Link>
      ) : null}
    </main>
  );
}
