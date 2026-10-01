/**
 * Committee and approver duties (FR-U3, FR-U6, FR-U7, FR-P7, T15): assign / remove, freelance with expiry,
 * coverage report (03-database §4 query 2). Every mutation: policy → Zod → transaction → audit row.
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString, formatTermLabel } from '../../lib/dates/index.ts';
import { newId } from '../../lib/ids.ts';
import { AppError, notFound, parseInput } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { withTransaction, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { send } from './notify.service.ts';

export const DUTY_MSG = {
  unknownUser: 'ไม่พบผู้ใช้',
  inactiveUser: 'บัญชีนี้ถูกปิดใช้งาน ให้ผู้ดูแลระบบสูงสุดเปิดก่อน',
  approverRole: 'ผู้อนุมัติต้องเป็นผู้ดูแลระบบ',
  targetRequired: 'กรุณาเลือกห้องเรียนหรือพื้นที่',
  classNotInTerm: 'ห้องเรียนนี้ไม่ได้ใช้ในภาคเรียนนี้',
  unknownTarget: 'ไม่พบห้องเรียนหรือพื้นที่ที่เลือก',
  wrongAreaType: (t: string) => `ภาคเรียนนี้ประเมินแบบ${t} เลือก${t}แทน`,
  inactiveArea: 'พื้นที่นี้ปิดใช้งานอยู่',
  duplicate: 'มอบหมายหน้าที่นี้ให้ผู้ใช้คนนี้แล้ว',
  freelanceExpiry: 'มอบหมายชั่วคราวต้องกำหนดวันหมดอายุในอนาคต',
  freelanceCommitteeOnly: 'มอบหมายชั่วคราวใช้ได้กับกรรมการประเมินเท่านั้น',
  closedTerm: 'ภาคเรียนนี้ปิดแล้ว แก้หน้าที่ไม่ได้',
} as const;

export const AREA_TYPE_LABEL = { building: 'อาคาร', zone: 'โซน' } as const;

export const assignDutyInput = z
  .object({
    termId: z.uuid(),
    userId: z.uuid(),
    duty: z.enum(['committee', 'approver']),
    targetType: z.enum(['class', 'area']).nullable().default(null),
    targetId: z.uuid().nullable().default(null),
    isFreelance: z.boolean().default(false),
    validUntil: z.date().nullable().default(null),
  })
  .refine((v) => v.duty === 'approver' || (v.targetType !== null && v.targetId !== null), {
    message: DUTY_MSG.targetRequired,
    path: ['targetId'],
  });
export type AssignDutyInput = z.input<typeof assignDutyInput>;

export const removeDutyInput = z.object({ dutyId: z.uuid() });

type Term = NonNullable<Awaited<ReturnType<typeof places.findTerm>>>;

async function loadTerm(db: Db | Tx, termId: string): Promise<Term> {
  const term = await places.findTerm(db, termId);
  if (!term) throw notFound();
  if (term.status === 'closed') throw new AppError('VALIDATION', { message: DUTY_MSG.closedTerm });
  return term;
}

/**
 * A duty target must be taking part in the term: a selected class (FR-P7) or an active area of the term's area
 * type (building or zone mode). Returns the label used in messages and audit rows.
 */
export async function checkTarget(
  db: Db | Tx,
  term: Term,
  targetType: 'class' | 'area',
  targetId: string,
): Promise<string> {
  if (targetType === 'class') {
    const cls = await places.findClass(db, targetId);
    if (!cls) throw new AppError('VALIDATION', { field: 'targetId', message: DUTY_MSG.unknownTarget });
    const selected = await places.listTermClassIds(db, term.id);
    if (!selected.includes(cls.id))
      throw new AppError('VALIDATION', { field: 'targetId', message: DUTY_MSG.classNotInTerm });
    return cls.displayName;
  }
  const area = await places.findArea(db, targetId);
  if (!area) throw new AppError('VALIDATION', { field: 'targetId', message: DUTY_MSG.unknownTarget });
  if (area.type !== term.areaType)
    throw new AppError('VALIDATION', {
      field: 'targetId',
      message: DUTY_MSG.wrongAreaType(AREA_TYPE_LABEL[term.areaType]),
    });
  if (!area.isActive) throw new AppError('VALIDATION', { field: 'targetId', message: DUTY_MSG.inactiveArea });
  return area.name;
}

export interface AssignOutcome {
  id: string;
  created: boolean;
  /** A disabled teacher account was enabled by this duty (06-auth §1). */
  enabledUser: boolean;
}

/**
 * Assign inside an open transaction (shared by the form and duties.xlsx). An identical duty still in force is
 * reported back with `created: false` when `allowExisting`, otherwise it is a validation error.
 */
export async function assignInTx(
  tx: Tx,
  actor: SessionUser,
  raw: AssignDutyInput,
  meta: ClientMeta,
  now: Date,
  opts: { allowExisting?: boolean } = {},
): Promise<AssignOutcome> {
  const input = parseInput(assignDutyInput, raw);
  const term = await loadTerm(tx, input.termId);
  const user = await usersRepo.findUserById(tx, input.userId);
  if (!user) throw new AppError('VALIDATION', { field: 'userId', message: DUTY_MSG.unknownUser });
  if (!user.isActive && user.role !== 'teacher')
    throw new AppError('VALIDATION', { field: 'userId', message: DUTY_MSG.inactiveUser });
  if (input.duty === 'approver' && user.role !== 'admin' && user.role !== 'super_admin')
    throw new AppError('VALIDATION', { field: 'userId', message: DUTY_MSG.approverRole });

  if (input.isFreelance) {
    if (input.duty !== 'committee')
      throw new AppError('VALIDATION', { field: 'isFreelance', message: DUTY_MSG.freelanceCommitteeOnly });
    if (!input.validUntil || input.validUntil <= now)
      throw new AppError('VALIDATION', { field: 'validUntil', message: DUTY_MSG.freelanceExpiry });
  }

  const hasTarget = input.targetType !== null && input.targetId !== null;
  const targetLabel = hasTarget ? await checkTarget(tx, term, input.targetType!, input.targetId!) : null;
  const key = {
    termId: term.id,
    userId: user.id,
    duty: input.duty,
    targetClassId: input.targetType === 'class' ? input.targetId : null,
    targetAreaId: input.targetType === 'area' ? input.targetId : null,
  };
  const existing = await dutiesRepo.findSameDuty(tx, key, now);
  if (existing) {
    if (opts.allowExisting) return { id: existing.id, created: false, enabledUser: false };
    throw new AppError('VALIDATION', { field: 'userId', message: DUTY_MSG.duplicate });
  }

  const id = newId();
  const row = {
    id,
    ...key,
    targetType: hasTarget ? input.targetType : null,
    isFreelance: input.isFreelance,
    validUntil: input.isFreelance ? input.validUntil : null,
    createdBy: actor.id,
    createdAt: now,
  };
  await dutiesRepo.insertDuty(tx, row);
  await writeAudit(
    tx,
    {
      actorId: actor.id,
      action: 'duty.assign',
      entity: 'duty',
      entityId: id,
      after: { ...row, username: user.username, target: targetLabel },
      ip: meta.ip,
    },
    now,
  );

  let enabledUser = false;
  if (!user.isActive) {
    await usersRepo.updateUser(tx, user.id, { isActive: true, updatedAt: now });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'user.activate',
        entity: 'user',
        entityId: user.id,
        before: { isActive: false },
        after: { isActive: true, reason: 'duty assigned' },
        ip: meta.ip,
      },
      now,
    );
    enabledUser = true;
  }
  return { id, created: true, enabledUser };
}

/** 11-jobs §2 `duty_assigned`: "{n} รายการ ภาคเรียนที่ {t}", n = committee targets the user now holds. */
export async function notifyDutyAssigned(tx: Tx, termId: string, userIds: readonly string[], now: Date) {
  const term = await places.findTerm(tx, termId);
  if (!term) return;
  for (const userId of new Set(userIds)) {
    const n = await dutiesRepo.countUserDuties(tx, termId, userId, 'committee', now);
    if (n === 0) continue;
    await send(
      tx,
      {
        userIds: [userId],
        type: 'duty_assigned',
        title: 'ได้รับมอบหมายเป็นกรรมการประเมิน',
        body: `${n} รายการ ${formatTermLabel(term.termNo, term.academicYear)}`,
        link: '/tasks',
      },
      now,
    );
  }
}

export async function assignDuty(
  db: Db,
  actor: SessionUser,
  raw: AssignDutyInput,
  meta: ClientMeta,
  now: Date,
): Promise<AssignOutcome> {
  assertCan(actor, 'duty.manage');
  const input = parseInput(assignDutyInput, raw);
  return withTransaction(db, async (tx) => {
    const outcome = await assignInTx(tx, actor, input, meta, now);
    if (input.duty === 'committee') await notifyDutyAssigned(tx, input.termId, [input.userId], now);
    return outcome;
  });
}

export async function removeDuty(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof removeDutyInput>,
  meta: ClientMeta,
  now: Date,
): Promise<void> {
  assertCan(actor, 'duty.manage');
  const { dutyId } = parseInput(removeDutyInput, raw);
  await withTransaction(db, async (tx) => {
    const duty = await dutiesRepo.findDuty(tx, dutyId);
    if (!duty) throw notFound();
    await loadTerm(tx, duty.termId);
    await dutiesRepo.deleteDuty(tx, duty.id);
    await writeAudit(
      tx,
      { actorId: actor.id, action: 'duty.remove', entity: 'duty', entityId: duty.id, before: duty, ip: meta.ip },
      now,
    );
  });
}

// ───────────── coverage (03-database §4 query 2, 08-ux-ui §6.13) ─────────────

export type CoverageStatus = 'none' | 'ok' | 'multiple';

export interface DutyHolder {
  dutyId: string;
  userId: string;
  displayName: string;
  isFreelance: boolean;
  validUntil: Date | null;
}

export interface CoverageTarget {
  targetType: 'class' | 'area';
  id: string;
  label: string;
  /** Current physical room of a class, e.g. "121" (helps admins who think in room numbers). */
  roomNumber: string | null;
  committee: DutyHolder[];
  approvers: DutyHolder[];
  status: CoverageStatus;
}

export interface CoverageGroup {
  title: string;
  targets: CoverageTarget[];
}

export interface CommitteeUser {
  id: string;
  username: string;
  displayName: string;
  role: SessionUser['role'];
  isActive: boolean;
  committeeCount: number;
  approverCount: number;
}

export interface CommitteeOverview {
  term: Term;
  groups: CoverageGroup[];
  users: CommitteeUser[];
  /** Approvers with no target approve everything (BR-E6). */
  generalApprovers: DutyHolder[];
  /** Freelance duties that already expired (kept as history, no longer count). */
  expired: (DutyHolder & { target: string })[];
  counts: { targets: number; none: number; multiple: number };
}

export const coverageStatus = (n: number): CoverageStatus => (n === 0 ? 'none' : n === 1 ? 'ok' : 'multiple');

export async function getCommitteeOverview(
  db: Db,
  actor: SessionUser,
  termId: string,
  now: Date,
): Promise<CommitteeOverview> {
  assertCan(actor, 'staff.read');
  const term = await places.findTerm(db, termId);
  if (!term) throw notFound();
  const today = bangkokDateString(now);
  const [classes, areas, rooms, links, selectedIds, duties, users] = await Promise.all([
    places.listClasses(db),
    places.listAreas(db),
    places.listRooms(db),
    places.listLinksOnDate(db, today),
    places.listTermClassIds(db, term.id),
    dutiesRepo.listTermDuties(db, term.id),
    usersRepo.listUsers(db),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const roomById = new Map(rooms.map((r) => [r.id, r.roomNumber]));
  const roomOfClass = new Map(links.map((l) => [l.classId, roomById.get(l.physicalRoomId) ?? null]));
  const inForce = (d: dutiesRepo.DutyRow) => d.validUntil === null || d.validUntil > now;
  const holder = (d: dutiesRepo.DutyRow): DutyHolder => ({
    dutyId: d.id,
    userId: d.userId,
    displayName: userById.get(d.userId)?.displayName ?? '–',
    isFreelance: d.isFreelance,
    validUntil: d.validUntil,
  });
  const active = duties.filter(inForce);
  const holdersOf = (duty: 'committee' | 'approver', type: 'class' | 'area', id: string) =>
    active
      .filter(
        (d) =>
          d.duty === duty &&
          d.targetType === type &&
          (type === 'class' ? d.targetClassId === id : d.targetAreaId === id),
      )
      .map(holder);
  const target = (type: 'class' | 'area', id: string, label: string, roomNumber: string | null): CoverageTarget => {
    const committee = holdersOf('committee', type, id);
    return {
      targetType: type,
      id,
      label,
      roomNumber,
      committee,
      approvers: holdersOf('approver', type, id),
      status: coverageStatus(committee.length),
    };
  };

  const selected = new Set(selectedIds);
  const groups: CoverageGroup[] = [];
  for (const c of classes.filter((c) => selected.has(c.id))) {
    let g = groups.find((x) => x.title === c.rankGroup);
    if (!g) groups.push((g = { title: c.rankGroup, targets: [] }));
    g.targets.push(target('class', c.id, c.displayName, roomOfClass.get(c.id) ?? null));
  }
  const termAreas = areas.filter((a) => a.type === term.areaType && a.isActive);
  if (termAreas.length > 0) {
    groups.push({
      title: AREA_TYPE_LABEL[term.areaType],
      targets: termAreas.map((a) => target('area', a.id, a.name, null)),
    });
  }

  const labelOf = (d: dutiesRepo.DutyRow) =>
    d.targetClassId
      ? (classes.find((c) => c.id === d.targetClassId)?.displayName ?? '–')
      : d.targetAreaId
        ? (areas.find((a) => a.id === d.targetAreaId)?.name ?? '–')
        : 'ทุกรายการ';
  const all = groups.flatMap((g) => g.targets);
  return {
    term,
    groups,
    users: users
      .filter((u) => u.isActive || u.role === 'teacher' || duties.some((d) => d.userId === u.id))
      .map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        isActive: u.isActive,
        committeeCount: active.filter((d) => d.userId === u.id && d.duty === 'committee').length,
        approverCount: active.filter((d) => d.userId === u.id && d.duty === 'approver').length,
      })),
    generalApprovers: active.filter((d) => d.duty === 'approver' && d.targetType === null).map(holder),
    expired: duties.filter((d) => !inForce(d)).map((d) => ({ ...holder(d), target: labelOf(d) })),
    counts: {
      targets: all.length,
      none: all.filter((t) => t.status === 'none').length,
      multiple: all.filter((t) => t.status === 'multiple').length,
    },
  };
}
