import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, ReadOnlyBanner } from '@/components/app/settings';
import { formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { getStudentsOverview, pendingSyncRequest } from '@/server/services/student.service';
import { AddSkipRuleForm, MapClassForm, RemoveSkipRuleButton, SyncNowButton } from './forms';

export const metadata: Metadata = { title: 'นักเรียน · AZIZSTAN ZERO WASTE' };

const STATUS: Record<string, { text: string; cls: string }> = {
  success: { text: 'สำเร็จ', cls: 'bg-brand-soft text-brand-ink' },
  aborted: { text: 'หยุดอัตโนมัติ', cls: 'bg-warn-soft text-warn-ink' },
  failed: { text: 'ล้มเหลว', cls: 'bg-danger-soft text-danger-ink' },
};
const SOURCE = { general: 'สามัญ', vocational: 'ปวช.' } as const;
const REASON: Record<string, string> = { no_class: 'ไม่มีชั้นเรียน', duplicate_code: 'รหัสซ้ำในไฟล์' };

/** 08-ux-ui §6.15: sync runs, review list (codes and class strings only), skip rules. No student names. */
export default async function StudentsPage() {
  const user = await requirePageUser('/admin/settings/students');
  const db = getDb();
  const [o, queued] = await Promise.all([getStudentsOverview(db, user), pendingSyncRequest(db)]);
  const canSync = can(user, 'student.sync');
  const canMap = can(user, 'place.manage');
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin" className="text-[14px] text-brand-ink underline">
            ← ภาพรวม
          </Link>
          <h1 className="mt-2 text-[20px] leading-[1.3] font-bold lg:text-[26px]">นักเรียน</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            ดึงรายชื่อจากระบบโรงเรียนทุกวัน 02:00 น. · นักเรียนที่ใช้งาน {o.activeCount} คน
          </p>
        </div>
        {canSync ? <SyncNowButton pending={queued} /> : null}
      </div>
      {!canSync ? <ReadOnlyBanner /> : null}
      <p role="note" className="rounded-md bg-surface-muted px-4 py-3 text-[14px]">
        ระบบเก็บเฉพาะรหัสนักเรียน ชื่อ และชั้นเรียน ไม่เก็บเลขประจำตัวประชาชน วันเกิด หรือข้อมูลผู้ปกครอง ·
        ข้อมูลนักเรียนที่ไม่ปรากฏในระบบโรงเรียนจะถูกลบหลัง 365 วัน
      </p>

      <Card title="ประวัติการ sync" id="runs-title">
        {o.runs.length === 0 ? (
          <p className="text-[14px] text-ink-muted">ยังไม่เคย sync</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]" data-testid="sync-runs">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">เวลา</th>
                  <th className="py-2 pr-3 font-medium">แหล่ง</th>
                  <th className="py-2 pr-3 font-medium">สถานะ</th>
                  <th className="py-2 font-medium">จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {o.runs.map((r) => {
                  const c = r.counts;
                  const st = r.status ? STATUS[r.status] : null;
                  return (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="py-2 pr-3">
                        {formatThaiDateTime(r.startedAt)}
                        {r.manual ? <span className="block text-[12px] text-ink-muted">สั่งโดยผู้ดูแล</span> : null}
                      </td>
                      <td className="py-2 pr-3">{SOURCE[r.source]}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${st?.cls ?? 'bg-surface-muted'}`}
                        >
                          {st?.text ?? 'กำลังทำงาน'}
                        </span>
                        {r.error ? <span className="mt-1 block text-[13px] text-danger-ink">{r.error}</span> : null}
                      </td>
                      <td className="py-2">
                        {[
                          ['แถว', c.rows],
                          ['เพิ่ม', c.added],
                          ['ย้ายห้อง', c.moved],
                          ['เปลี่ยนชื่อ', c.renamed],
                          ['เลิกใช้งาน', c.inactive],
                          ['รอตรวจสอบ', c.review],
                          ['ไฟล์ผิดรูปแบบ', c.malformed],
                          ['ข้าม', c.skipped],
                          ['สร้างห้องเรียน', c.created],
                        ]
                          .filter(([, n]) => (n as number | undefined) !== undefined && (n as number) > 0)
                          .map(([l, n]) => `${l} ${n}${l === 'ข้าม' ? ' คน' : l === 'สร้างห้องเรียน' ? ' ห้อง' : ''}`)
                          .join(' · ') || '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`รอตรวจสอบ ${o.review.length}`} id="review-title">
        {o.review.length === 0 ? (
          <p className="text-[14px] text-ink-muted">ไม่มีนักเรียนที่รอตรวจสอบ</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="review-list">
            {o.review.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-semibold">{s.code}</span>
                  <span className="ml-2 text-ink-muted">
                    {s.classString ? `ชั้น "${s.classString}" ไม่รู้จัก` : (REASON[s.reason ?? ''] ?? s.reason)}
                  </span>
                </span>
                {s.classString && canMap ? <MapClassForm alias={s.classString} classes={o.classes} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="ชั้นที่ไม่นำเข้า" id="skip-title">
        <p className="mb-3 text-[14px] text-ink-muted">
          นักเรียนที่มีเฉพาะชั้นศาสนาซึ่งขึ้นต้นด้วยคำเหล่านี้จะไม่ถูกนำเข้า และไม่ต้องตรวจสอบ
        </p>
        <ul className="mb-3 flex flex-col divide-y divide-line">
          {o.skipRules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <code className="rounded bg-surface-muted px-1.5">{r.prefix}</code>
                {r.note ? <span className="ml-2 text-[13px] text-ink-muted">{r.note}</span> : null}
              </span>
              {canSync ? <RemoveSkipRuleButton id={r.id} prefix={r.prefix} /> : null}
            </li>
          ))}
        </ul>
        {canSync ? <AddSkipRuleForm /> : null}
      </Card>
    </main>
  );
}
