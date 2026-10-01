import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, ReadOnlyBanner } from '@/components/app/settings';
import { formatTermLabel, formatThaiDateTime } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { listApiKeys, listPp5Terms, pp5Cidrs } from '@/server/services/pp5.service';
import { CreateKeyForm, RevokeButton } from './KeyForms';

export const metadata: Metadata = { title: 'การเชื่อมต่อ API · AZIZSTAN ZERO WASTE' };

/** 08-ux-ui §6.20 "การเชื่อมต่อ API": ปพ.5 keys, allowed networks, and the term Excel export (FR-I4 fallback). */
export default async function ApiSettingsPage() {
  const user = await requirePageUser('/admin/settings/api');
  const db = getDb();
  const [keys, terms] = await Promise.all([listApiKeys(db, user), listPp5Terms(db)]);
  const canManage = can(user, 'apikey.manage');
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <Link href="/admin" className="text-[14px] text-brand-ink underline">
          ← ภาพรวม
        </Link>
        <h1 className="mt-2 text-[20px] leading-[1.3] font-bold lg:text-[26px]">การเชื่อมต่อ API</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          โปรแกรม ปพ.5 ดึงคะแนนได้เฉพาะรอบที่ปิดรอบแล้ว เป็นไฟล์ CSV ผ่าน <code>/api/v1/pp5/…</code> (เติม{' '}
          <code>?format=json</code> หากต้องการ JSON) พร้อมคีย์ และต้องเรียกจากเครือข่ายของโรงเรียน
        </p>
      </div>
      {!canManage ? <ReadOnlyBanner /> : null}

      <Card title="คีย์สำหรับ ปพ.5" id="keys-title">
        {canManage ? <CreateKeyForm /> : null}
        {keys.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-muted">ยังไม่มีคีย์</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-line" data-testid="api-keys">
            {keys.map((k) => (
              <li
                key={k.id}
                data-testid={`api-key-${k.name}`}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <span>
                  <span className="font-semibold">{k.name}</span>
                  <span className="ml-2 text-[13px] text-ink-muted">
                    สร้าง {formatThaiDateTime(k.createdAt)} · ใช้ล่าสุด{' '}
                    {k.lastUsedAt ? formatThaiDateTime(k.lastUsedAt) : '–'}
                    {k.revokedAt ? ` · ยกเลิกแล้ว ${formatThaiDateTime(k.revokedAt)}` : ''}
                  </span>
                </span>
                {canManage && !k.revokedAt ? <RevokeButton id={k.id} name={k.name} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="เครือข่ายที่อนุญาต" id="cidr-title">
        <p className="text-[14px] text-ink-muted">ตั้งค่าใน .env (PP5_ALLOWED_CIDRS)</p>
        <p className="mt-2 font-mono text-[14px]">{pp5Cidrs().join(', ')}</p>
      </Card>

      <Card title="ส่งออกผลคะแนน (Excel)" id="export-title">
        <ul className="flex flex-col divide-y divide-line">
          {terms.map((t) => (
            <li key={t.termId} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>
                {formatTermLabel(t.termNo, t.academicYear)}
                <span className="ml-2 text-[13px] text-ink-muted">
                  ปิดรอบแล้ว {t.roundsFinalized.length}/{t.roundsTotal} รอบ
                </span>
              </span>
              <a
                href={`/api/v1/exports/terms/${t.termId}`}
                className="text-[14px] font-semibold text-brand-ink underline"
              >
                ดาวน์โหลด Excel
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
