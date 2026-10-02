/**
 * First-day setup checklist on /admin (14-deployment §2 step 7): the order an admin fills the system in on a new
 * install, each step ticked from the data already there. Disappears from the dashboard once every step is done.
 * Guide pages are not a step: migrations ship default pages, so an install starts with them.
 */
import type { Db } from '../../../db/client.ts';
import { formatTermLabel } from '../../lib/dates/index.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as places from '../repositories/places.repository.ts';
import { countSetup } from '../repositories/setup.repository.ts';

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  /** what is there now, or what is missing */
  detail: string;
  href: string;
}

export async function getSetupChecklist(db: Db, actor: SessionUser): Promise<SetupStep[]> {
  assertCan(actor, 'round.manage');
  const term = await places.findActiveTerm(db);
  const c = await countSetup(db, term?.id ?? null);
  const area = term?.areaType === 'zone' ? 'โซน' : 'อาคาร';
  const needTerm = 'เปิดใช้ภาคเรียนก่อน';
  const count = (value: number, unit: string, empty: string) => (value > 0 ? `${value} ${unit}` : empty);
  const perTerm = (value: number, unit: string, empty: string) => (term ? count(value, unit, empty) : needTerm);

  return [
    {
      key: 'areas',
      label: `${area}`,
      done: c.areas > 0,
      detail: count(c.areas, 'แห่ง', `ยังไม่มี${area}`),
      href: '/admin/settings/classes',
    },
    {
      key: 'rooms',
      label: 'หมายเลขห้อง',
      done: c.rooms > 0,
      detail: count(c.rooms, 'ห้อง', 'ยังไม่มีห้อง'),
      href: '/admin/settings/classes',
    },
    {
      key: 'classes',
      label: 'ห้องเรียนและชื่อเรียกอื่น',
      done: c.classes > 0,
      detail: count(c.classes, 'ห้องเรียน', 'ยังไม่มีห้องเรียน · sync รายชื่อสร้างห้องสามัญและ ปวช. ให้ได้'),
      href: '/admin/settings/classes',
    },
    {
      key: 'term',
      label: 'ภาคเรียนและรูปแบบการประเมิน',
      done: term !== null,
      detail: term ? `ใช้งาน ${formatTermLabel(term.termNo, term.academicYear)}` : 'ยังไม่มีภาคเรียนที่ใช้งาน',
      href: '/admin/settings/term',
    },
    {
      key: 'students',
      label: 'ซิงก์รายชื่อนักเรียน',
      done: c.syncedOk > 0,
      detail: c.syncedOk > 0 ? 'ซิงก์สำเร็จแล้ว' : 'ยังไม่เคยซิงก์สำเร็จ',
      href: '/admin/settings/students',
    },
    {
      key: 'rounds',
      label: 'รอบการประเมิน',
      done: c.rounds > 0,
      detail: perTerm(c.rounds, 'รอบ', 'ยังไม่มีรอบ'),
      href: '/admin/settings/scoring',
    },
    {
      key: 'term-classes',
      label: 'ห้องเรียนที่ร่วมประเมินภาคนี้',
      done: c.termClasses > 0,
      detail: perTerm(c.termClasses, 'ห้องเรียน', 'ยังไม่ได้เลือก'),
      href: '/admin/settings/classes',
    },
    {
      key: 'duties',
      label: 'คณะกรรมการ',
      done: c.duties > 0,
      detail: perTerm(c.duties, 'หน้าที่', 'ยังไม่ได้มอบหมาย'),
      href: '/admin/settings/committee',
    },
    {
      key: 'orders',
      label: 'คำสั่งแต่งตั้ง (PDF)',
      done: c.orders > 0,
      detail: perTerm(c.orders, 'ฉบับ', 'ยังไม่ได้อัปโหลด'),
      href: '/admin/settings/content',
    },
  ];
}
