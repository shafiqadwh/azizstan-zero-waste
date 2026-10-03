import type { Metadata } from 'next';
import { formatTermLabel } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { ERRORS } from '@/server/errors';
import { can } from '@/server/policies';
import { getActiveTermSelection, getPlaces } from '@/server/services/place.service';
import { AddBuildingForm, AddClassForm } from './AddForms';
import { ClassRow } from './ClassRow';
import { TermClassesCard } from './TermClassesCard';

export const metadata: Metadata = { title: 'ห้องเรียน · AZIZSTAN ZERO WASTE' };

/**
 * 08-ux-ui §6.14: classes used this term with their building or zone (FR-P7, FR-P4) · class register (aliases) ·
 * buildings. Physical rooms moved to the facilities system (2026-10-03): evaluation is per class.
 */
export default async function ClassesPage() {
  const user = await requirePageUser('/admin/settings/classes');
  const db = getDb();
  const [places, selection] = await Promise.all([getPlaces(db, user), getActiveTermSelection(db, user)]);
  const canManage = can(user, 'place.manage');
  const canConfigure = can(user, 'term.configure');

  const buildings = places.areas.filter((a) => a.type === 'building');
  const groups = [...new Set(places.classes.map((c) => c.rankGroup))];

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ห้องเรียนและอาคาร</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          ห้องเรียน {places.classes.length} · อาคาร {buildings.length}
        </p>
      </div>

      {!canManage ? (
        <p role="note" className="rounded-md bg-surface-muted px-4 py-3 text-[14px]">
          โหมดดูอย่างเดียว
        </p>
      ) : null}

      {selection ? (
        <TermClassesCard
          termId={selection.term.id}
          termLabel={formatTermLabel(selection.term.termNo, selection.term.academicYear)}
          classes={places.classes.map((c) => ({
            id: c.id,
            displayName: c.displayName,
            rankGroup: c.rankGroup,
            isActive: c.isActive,
          }))}
          selected={selection.classIds}
          areaByClass={selection.areaByClass}
          areaKind={selection.term.areaType === 'zone' ? 'โซน' : 'อาคาร'}
          areas={places.areas
            .filter((a) => a.type === selection.term.areaType && a.isActive)
            .map((a) => ({ id: a.id, name: a.name }))}
          readOnly={!canConfigure || selection.term.configLockedAt !== null}
          lockedNote={selection.term.configLockedAt ? ERRORS.CONFIG_LOCKED.message : null}
        />
      ) : (
        <p className="rounded-lg border border-line bg-surface px-5 py-4">
          ยังไม่มีภาคเรียนที่เปิดใช้ · เลือกห้องเรียนที่ใช้ได้หลังเปิดภาคเรียน
        </p>
      )}

      <section aria-labelledby="classes" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="classes" className="mb-1 text-[17px] font-bold">
          ทะเบียนห้องเรียน
        </h2>
        <p className="mb-3 text-[13px] text-ink-muted">ชื่อเรียกอื่น ใช้จับคู่ชื่อชั้นในข้อมูลนักเรียน</p>
        {places.classes.length === 0 ? (
          <p className="py-4">ยังไม่มีห้องเรียน · เพิ่มห้องเรียนด้านล่าง</p>
        ) : (
          groups.map((g) => (
            <div key={g} className="mt-3">
              <h3 className="text-[15px] font-bold text-brand-ink">{g}</h3>
              <ul>
                {places.classes
                  .filter((c) => c.rankGroup === g)
                  .map((c) => (
                    <ClassRow key={c.id} cls={c} canManage={canManage} />
                  ))}
              </ul>
            </div>
          ))
        )}
        {canManage ? (
          <details className="mt-4 rounded-lg border border-line p-4">
            <summary className="cursor-pointer font-semibold">+ เพิ่มห้องเรียน</summary>
            <div className="mt-3">
              <AddClassForm />
            </div>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="buildings" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="buildings" className="mb-1 text-[17px] font-bold">
          อาคาร
        </h2>
        <p className="mb-3 text-[13px] text-ink-muted">
          กรรมการประเมินอาคาร · เลือกอาคารของแต่ละห้องเรียนได้ที่ส่วนห้องเรียนที่ใช้ด้านบน ·
          ห้องและหมายเลขห้องย้ายไปอยู่ในระบบฝ่ายอาคารสถานที่
        </p>
        {buildings.length === 0 ? (
          <p className="mb-3">ยังไม่มีอาคาร · เพิ่มอาคารด้านล่าง</p>
        ) : (
          <ul className="mb-2 flex flex-wrap gap-2">
            {buildings.map((b) => (
              <li key={b.id} className="rounded-lg border border-line px-3 py-2 text-[14px]">
                {b.name}
                {!b.isActive ? <span className="ml-1 text-[12px] text-ink-muted">(ปิดใช้งาน)</span> : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="mt-4 border-t border-line pt-4">
            <AddBuildingForm />
          </div>
        ) : null}
      </section>
    </main>
  );
}
