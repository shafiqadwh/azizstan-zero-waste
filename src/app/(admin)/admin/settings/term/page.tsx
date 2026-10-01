import type { Metadata } from 'next';
import { Card, ReadOnlyBanner } from '@/components/app/settings';
import { formatThaiDate, formatTermLabel } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { listTerms } from '@/server/services/term.service';
import { ActivateButton, CreateTermForm } from './TermForms';

export const metadata: Metadata = { title: 'ภาคเรียน · AZIZSTAN ZERO WASTE' };

const STATUS = { active: 'เปิดใช้', draft: 'ร่าง', closed: 'ปิดแล้ว' } as const;

/** 08-ux-ui §6.20 "ภาคเรียนและการเปิดเทอมใหม่": term list, create (copy from previous, BR-TM1), activate (BR-TM4). */
export default async function TermsPage() {
  const user = await requirePageUser('/admin/settings/term');
  const terms = await listTerms(getDb(), user);
  const canConfigure = can(user, 'term.configure');
  const newest = terms[0];
  const suggested = newest
    ? newest.termNo >= 2
      ? { academicYear: newest.academicYear + 1, termNo: 1 }
      : { academicYear: newest.academicYear, termNo: 2 }
    : { academicYear: 2569, termNo: 2 };

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ภาคเรียนและการเปิดเทอมใหม่</h1>
      {!canConfigure ? <ReadOnlyBanner /> : null}

      <Card title="ภาคเรียนทั้งหมด" id="terms">
        {terms.length === 0 ? (
          <p>ยังไม่มีภาคเรียน · สร้างภาคเรียนแรกด้านล่าง</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {terms.map((t) => (
              <li
                key={t.id}
                data-testid={`term-${t.termNo}-${t.academicYear}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="font-semibold">{formatTermLabel(t.termNo, t.academicYear)}</p>
                  <p className="text-[13px] text-ink-muted">
                    {STATUS[t.status]}
                    {t.configLockedAt ? ' · ล็อกการตั้งค่าแล้ว' : ''}
                    {t.purgeAfter ? ` · ลบข้อมูลตามกำหนด ${formatThaiDate(new Date(`${t.purgeAfter}T05:00:00Z`))}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <a
                    href={`/admin/settings/mode?term=${t.id}`}
                    className="inline-flex h-11 items-center rounded-md px-3 text-[14px] font-medium text-brand-ink underline"
                  >
                    รูปแบบการประเมิน
                  </a>
                  <a
                    href={`/admin/settings/scoring?term=${t.id}`}
                    className="inline-flex h-11 items-center rounded-md px-3 text-[14px] font-medium text-brand-ink underline"
                  >
                    ส่วนคะแนนและรอบ
                  </a>
                  {canConfigure && t.status !== 'active' ? (
                    <ActivateButton termId={t.id} label={formatTermLabel(t.termNo, t.academicYear)} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canConfigure ? (
        <Card title="สร้างภาคเรียนใหม่" id="create-term">
          <CreateTermForm
            terms={terms.map((t) => ({ id: t.id, label: formatTermLabel(t.termNo, t.academicYear) }))}
            suggested={suggested}
          />
        </Card>
      ) : null}
    </main>
  );
}
