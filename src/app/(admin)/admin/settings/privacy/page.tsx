import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@/components/app/settings';
import { formatTermLabel, formatThaiDate, formatThaiDateTime } from '@/lib/dates';
import { redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/current-user';
import { homeFor } from '@/server/auth/redirects';
import { getDb } from '@/server/db';
import { isStaffRole } from '@/server/policies';
import { getRetentionOverview, type RetentionTermView } from '@/server/services/retention.service';
import { DISK_ALERT_RATIO, formatGb, formatPercent } from '@/server/services/disk.service';

export const metadata: Metadata = { title: 'ข้อมูลและความเป็นส่วนตัว · AZIZSTAN ZERO WASTE' };

const thaiDate = (d: string) => formatThaiDate(new Date(`${d}T00:00:00+07:00`));

function state(t: RetentionTermView): string {
  if (t.purgedAt) return `ข้อมูลถูกลบตามกำหนดแล้ว (${formatThaiDate(t.purgedAt)})`;
  if (t.status === 'active') return 'ใช้งานอยู่ · ข้อมูลเก็บต่อจนปิดภาคเรียนแล้ว 1 ปี';
  if (t.status === 'draft') return 'ร่าง';
  if (!t.purgeAfter) return 'ปิดแล้ว';
  const left = t.daysLeft ?? 0;
  return `ปิดแล้ว · ลบข้อมูลวันที่ ${thaiDate(t.purgeAfter)}${left > 0 ? ` (อีก ${left} วัน)` : ' (คืนนี้)'}`;
}

/** 08-ux-ui §6.20 "ข้อมูลและความเป็นส่วนตัว": retention per term (BR-D1..D3), archive downloads, last backup. */
export default async function PrivacyPage() {
  const user = await requirePageUser('/admin/settings/privacy');
  // layouts and pages render in parallel: repeat the layout's guard so a teacher never reaches the service
  if (!isStaffRole(user.role)) redirect(homeFor(user.role));
  const o = await getRetentionOverview(getDb(), user, new Date());
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <Link href="/admin" className="text-[14px] text-brand-ink underline">
          ← ภาพรวม
        </Link>
        <h1 className="mt-2 text-[20px] leading-[1.3] font-bold lg:text-[26px]">ข้อมูลและความเป็นส่วนตัว</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          ข้อมูลของภาคเรียน (คะแนน ผลประเมิน รูปหลักฐาน PDF คำขอ และประวัติการแก้ไข) เก็บไว้ {o.retentionDays} วัน
          หลังปิดภาคเรียน แล้วลบอัตโนมัติ ผู้ดูแลจะได้รับแจ้งเตือนล่วงหน้า {o.warnDays} วัน เพื่อดาวน์โหลดข้อมูลเก็บถาวร
          อาคาร ห้องเรียน และผู้ใช้ไม่ถูกลบ
        </p>
      </div>

      <Card title="ภาคเรียนและกำหนดลบข้อมูล" id="retention-title">
        {o.terms.length === 0 ? (
          <p className="text-[14px] text-ink-muted">ยังไม่มีภาคเรียน</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {o.terms.map((t) => (
              <li
                key={t.id}
                data-testid={`retention-${t.termNo}-${t.academicYear}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="font-semibold">{formatTermLabel(t.termNo, t.academicYear)}</p>
                  <p
                    className={
                      t.daysLeft !== null && t.daysLeft <= o.warnDays && !t.purgedAt
                        ? 'text-[13px] font-semibold text-danger-ink'
                        : 'text-[13px] text-ink-muted'
                    }
                  >
                    {state(t)}
                  </p>
                </div>
                {!t.purgedAt && t.status !== 'draft' ? (
                  <div className="flex flex-wrap gap-4">
                    <a
                      href={`/api/v1/exports/terms/${t.id}`}
                      className="inline-flex h-11 items-center text-[14px] font-semibold text-brand-ink underline"
                    >
                      ผลคะแนน (Excel)
                    </a>
                    <a
                      href={`/api/v1/exports/terms/${t.id}/pdfs`}
                      className="inline-flex h-11 items-center text-[14px] font-semibold text-brand-ink underline"
                    >
                      PDF ทั้งหมด (ZIP)
                    </a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="การสำรองข้อมูล" id="backup-title">
        <p className="text-[14px]" data-testid="last-backup">
          สำรองข้อมูลล่าสุด: {o.lastBackupAt ? formatThaiDateTime(o.lastBackupAt) : 'ยังไม่มีบันทึก'}
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          สำรองทุกคืนเวลา 01:30 น. (ฐานข้อมูล รูปหลักฐาน และ PDF) เข้ารหัสแล้วคัดลอกออกนอกเครื่อง ·
          ขั้นตอนกู้คืนอยู่ในเอกสาร 14-deployment §5
        </p>
      </Card>

      <Card title="พื้นที่ดิสก์" id="disk-title">
        {o.disk ? (
          <p
            className={`text-[14px] ${o.disk.usedRatio >= DISK_ALERT_RATIO ? 'font-semibold text-danger-ink' : ''}`}
            data-testid="disk-usage"
          >
            ใช้ไป {formatPercent(o.disk.usedRatio)} · เหลือ {formatGb(o.disk.freeBytes)} จาก{' '}
            {formatGb(o.disk.totalBytes)}
          </p>
        ) : (
          <p className="text-[14px]" data-testid="disk-usage">
            ยังไม่มีผลตรวจ
          </p>
        )}
        <p className="mt-1 text-[13px] text-ink-muted">
          ระบบตรวจทุกชั่วโมง{o.disk ? ` (ล่าสุด ${formatThaiDateTime(new Date(o.disk.at))})` : ''} · ใช้เกิน{' '}
          {formatPercent(DISK_ALERT_RATIO)} จะแจ้งเตือนแอดมินวันละครั้ง ถ้าดิสก์เต็ม ระบบจะรับรูปและสร้าง PDF ไม่ได้
        </p>
      </Card>

      <Card title="ประวัติการทำรายการ" id="audit-title">
        <p className="text-[14px]">
          ทุกการเปลี่ยนแปลงถูกบันทึกไว้และแก้ไขไม่ได้ ·{' '}
          <Link href="/admin/audit" className="font-semibold text-brand-ink underline">
            เปิดประวัติการทำรายการ
          </Link>
        </p>
      </Card>
    </main>
  );
}
