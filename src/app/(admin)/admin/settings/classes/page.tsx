import type { Metadata } from 'next';
import { formatTermLabel } from '@/lib/dates';
import { requirePageUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { ERRORS } from '@/server/errors';
import { can } from '@/server/policies';
import { getActiveTermSelection, getPlaces } from '@/server/services/place.service';
import { AddBuildingForm, AddClassForm, AddRoomForm } from './AddForms';
import { ClassRow } from './ClassRow';
import { RoomsImport } from './RoomsImport';
import { TermClassesCard } from './TermClassesCard';

export const metadata: Metadata = { title: 'ห้องเรียน · AZIZSTAN ZERO WASTE' };

/** 08-ux-ui §6.14: areas · rooms · classes (aliases, current room, move) · classes used this term (FR-P7). */
export default async function ClassesPage() {
  const user = await requirePageUser('/admin/settings/classes');
  const db = getDb();
  const now = new Date();
  const [places, selection] = await Promise.all([getPlaces(db, user, now), getActiveTermSelection(db, user)]);
  const canManage = can(user, 'place.manage');
  const canConfigure = can(user, 'term.configure');

  const buildings = places.areas.filter((a) => a.type === 'building');
  const className = new Map(places.classes.map((c) => [c.id, c.displayName]));
  const roomOptions = places.rooms
    .filter((r) => r.isActive)
    .map((r) => ({
      id: r.id,
      roomNumber: r.roomNumber,
      label: `${r.roomNumber}${r.currentClassId ? ` (${className.get(r.currentClassId)})` : ''}`,
    }));
  const groups = [...new Set(places.classes.map((c) => c.rankGroup))];

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ห้องเรียน อาคาร และหมายเลขห้อง</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          ห้องเรียน {places.classes.length} · ห้อง {places.rooms.length} · อาคาร {buildings.length}
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
        <p className="mb-3 text-[13px] text-ink-muted">
          ย้ายห้อง: ห้องเดิมจะสิ้นสุดในวันที่มีผล ประวัติเดิมยังอยู่ · ชื่อเรียกอื่น ใช้จับคู่ชื่อชั้นในข้อมูลนักเรียน
        </p>
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
                    <ClassRow key={c.id} cls={c} rooms={roomOptions} today={places.today} canManage={canManage} />
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

      <section aria-labelledby="rooms" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="rooms" className="mb-3 text-[17px] font-bold">
          อาคารและหมายเลขห้อง
        </h2>
        {buildings.length === 0 ? <p className="mb-3">ยังไม่มีอาคาร · เพิ่มอาคารหรือนำเข้าจาก Excel</p> : null}
        <div className="flex flex-col gap-4">
          {buildings.map((b) => {
            const rooms = places.rooms.filter((r) => r.buildingId === b.id);
            return (
              <div key={b.id}>
                <h3 className="font-semibold">
                  {b.name} <span className="text-[13px] font-normal text-ink-muted">· {rooms.length} ห้อง</span>
                </h3>
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {rooms.map((r) => (
                    <li
                      key={r.id}
                      className={`rounded-lg px-3 py-2 text-[13px] ${r.currentClassId ? 'border border-line' : 'border border-dashed border-warn-ink text-warn-ink'}`}
                    >
                      <span className="block text-[16px] font-bold text-ink">{r.roomNumber}</span>
                      {r.currentClassId ? className.get(r.currentClassId) : 'ยังไม่ผูกห้องเรียน'}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {canManage ? (
          <div className="mt-5 flex flex-col gap-4 border-t border-line pt-4">
            <AddBuildingForm />
            <AddRoomForm buildings={buildings.map((b) => ({ id: b.id, name: b.name }))} />
            <div>
              <h3 className="mb-2 font-semibold">นำเข้าจาก Excel</h3>
              <RoomsImport />
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
