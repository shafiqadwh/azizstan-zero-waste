/**
 * Round life cycle run by the worker (BR-R1 open, BR-R2 close, 11-jobs §1) and the admin's correction of the
 * frozen class → area rows (BR-R4, Q17). Handlers are idempotent and write audit rows with `actor_id = null`.
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString, formatThaiDateTime } from '../../lib/dates/index.ts';
import { AppError, notFound, parseInput } from '../errors.ts';
import { assertCan, can, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import { withTransaction, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { send } from './notify.service.ts';

export const ROUND_OPEN_QUEUE = 'round.open';
export const ROUND_CLOSE_QUEUE = 'round.close';

export const ROUND_MSG = {
  notOpened: 'รอบนี้ยังไม่เปิด ระบบจะกำหนดพื้นที่ให้เมื่อเปิดรอบ',
  finalized: 'รอบนี้ปิดรอบแล้ว แก้ไม่ได้',
  classNotInTerm: 'ห้องเรียนนี้ไม่ได้ใช้ในภาคเรียนนี้',
  wrongArea: 'เลือกพื้นที่ตามรูปแบบการประเมินของภาคเรียนนี้',
} as const;

type RoundClassArea = repo.RoundClassAreaRow;

/**
 * BR-R1 step 2: the frozen area of every class selected for the term.
 * Building mode: the building of the room the class is linked to on the (Bangkok) date of `opens_at`.
 * Zone mode: the class's `term_class_zones` row. A class with no area gets no row ("ไม่มีพื้นที่").
 */
export async function computeClassAreas(
  tx: Tx,
  term: { id: string; areaType: 'building' | 'zone' },
  roundId: string,
  opensAt: Date,
): Promise<{ rows: RoundClassArea[]; missing: string[] }> {
  // one connection inside a transaction: reads run one after another
  const selected = await places.listTermClassIds(tx, term.id);
  const links = await places.listLinksOnDate(tx, bangkokDateString(opensAt));
  const rooms = await places.listRooms(tx);
  const zones = term.areaType === 'zone' ? await termsRepo.listTermClassZones(tx, term.id) : [];
  const buildingOfRoom = new Map(rooms.map((r) => [r.id, r.buildingId]));
  const roomOfClass = new Map(links.map((l) => [l.classId, l.physicalRoomId]));
  const zoneOfClass = new Map(zones.map((z) => [z.classId, z.areaId]));
  const rows: RoundClassArea[] = [];
  const missing: string[] = [];
  for (const classId of selected) {
    const physicalRoomId = roomOfClass.get(classId) ?? null;
    const areaId =
      term.areaType === 'building'
        ? physicalRoomId
          ? (buildingOfRoom.get(physicalRoomId) ?? null)
          : null
        : (zoneOfClass.get(classId) ?? null);
    if (areaId) rows.push({ roundId, classId, areaId, physicalRoomId });
    else missing.push(classId);
  }
  return { rows, missing };
}

export interface OpenOutcome {
  changed: boolean;
  classes?: number;
  missingArea?: string[];
  students?: number;
}

/** Job `round.open` (BR-R1). No-op unless the round is scheduled, its time has come and its term is active. */
export async function openRound(db: Db, roundId: string, now: Date): Promise<OpenOutcome> {
  return withTransaction(db, async (tx) => {
    const round = await repo.lockRound(tx, roundId);
    if (!round || round.status !== 'scheduled' || round.opensAt > now) return { changed: false };
    const term = await places.findTerm(tx, round.termId);
    if (!term || term.status !== 'active') return { changed: false };

    const { rows, missing } = await computeClassAreas(tx, term, round.id, round.opensAt);
    await repo.replaceRoundClassAreas(tx, round.id, rows);
    const selected = await places.listTermClassIds(tx, term.id);
    const roster = (await repo.listActiveStudentsIn(tx, selected)).filter(
      (s): s is { studentId: string; classId: string } => s.classId !== null,
    );
    await repo.replaceRosterSnapshots(tx, round.id, roster);
    await repo.setRoundStatus(tx, round.id, 'open');
    const outcome = { classes: rows.length, missingArea: missing, students: roster.length };
    await writeAudit(
      tx,
      { actorId: null, action: 'round.open', entity: 'round', entityId: round.id, after: outcome },
      now,
    );
    await send(
      tx,
      {
        userIds: await dutiesRepo.listCommitteeUserIds(tx, term.id, now),
        type: 'round_opened',
        title: `เปิดลงคะแนนรอบที่ ${round.roundNo} แล้ว`,
        body: `ลงคะแนนได้ถึง ${formatThaiDateTime(round.closesAt)}`,
        link: '/tasks',
      },
      now,
    );
    return { changed: true, ...outcome };
  });
}

/** Job `round.close` (BR-R2). No-op unless the round is open and `closes_at` has passed. */
export async function closeRound(db: Db, roundId: string, now: Date): Promise<{ changed: boolean }> {
  return withTransaction(db, async (tx) => {
    const round = await repo.lockRound(tx, roundId);
    if (!round || round.status !== 'open' || round.closesAt > now) return { changed: false };
    await repo.setRoundStatus(tx, round.id, 'closed');
    await writeAudit(
      tx,
      {
        actorId: null,
        action: 'round.close',
        entity: 'round',
        entityId: round.id,
        before: { status: 'open' },
        after: { status: 'closed' },
      },
      now,
    );
    return { changed: true };
  });
}

/**
 * Worker sweep (every minute): enqueue `round.open` / `round.close` for rounds whose time has come. Dates are
 * read at sweep time, so an admin's date change (BR-R5) reschedules the job without any extra bookkeeping.
 */
export async function sweepRounds(
  db: Db,
  now: Date,
  enqueue: (queue: typeof ROUND_OPEN_QUEUE | typeof ROUND_CLOSE_QUEUE, roundId: string) => Promise<unknown>,
): Promise<{ open: number; close: number }> {
  const toOpen = await repo.listDueRounds(db, 'scheduled', now);
  const toClose = await repo.listDueRounds(db, 'open', now);
  for (const r of toOpen) await enqueue(ROUND_OPEN_QUEUE, r.id);
  for (const r of toClose) await enqueue(ROUND_CLOSE_QUEUE, r.id);
  return { open: toOpen.length, close: toClose.length };
}

// ───────────── admin: classes and areas of a round (BR-R4) ─────────────

export const editRoundClassAreaInput = z.object({ roundId: z.uuid(), classId: z.uuid(), areaId: z.uuid() });

export interface RoundAreaRow {
  classId: string;
  displayName: string;
  rankGroup: string;
  areaId: string | null;
  roomNumber: string | null;
}

export interface RoundAreasView {
  round: NonNullable<Awaited<ReturnType<typeof termsRepo.findRound>>>;
  term: NonNullable<Awaited<ReturnType<typeof places.findTerm>>>;
  rows: RoundAreaRow[];
  areas: { id: string; name: string }[];
  missing: number;
  editable: boolean;
}

const editableStatus = (s: string) => s === 'open' || s === 'closed';

export async function getRoundAreas(db: Db, actor: SessionUser, roundId: string): Promise<RoundAreasView> {
  assertCan(actor, 'staff.read');
  const round = await termsRepo.findRound(db, parseInput(z.uuid(), roundId));
  if (!round) throw notFound();
  const term = (await places.findTerm(db, round.termId))!;
  const [classes, areas, rooms, selected, frozen] = await Promise.all([
    places.listClasses(db),
    places.listAreas(db),
    places.listRooms(db),
    places.listTermClassIds(db, term.id),
    repo.listRoundClassAreas(db, round.id),
  ]);
  const chosen = new Set(selected);
  const byClass = new Map(frozen.map((r) => [r.classId, r]));
  const roomNo = new Map(rooms.map((r) => [r.id, r.roomNumber]));
  const rows = classes
    .filter((c) => chosen.has(c.id))
    .map((c) => {
      const f = byClass.get(c.id);
      return {
        classId: c.id,
        displayName: c.displayName,
        rankGroup: c.rankGroup,
        areaId: f?.areaId ?? null,
        roomNumber: f?.physicalRoomId ? (roomNo.get(f.physicalRoomId) ?? null) : null,
      };
    });
  return {
    round,
    term,
    rows,
    areas: areas.filter((a) => a.type === term.areaType && a.isActive).map((a) => ({ id: a.id, name: a.name })),
    missing: round.status === 'scheduled' ? 0 : rows.filter((r) => r.areaId === null).length,
    editable: can(actor, 'round.manage') && editableStatus(round.status),
  };
}

export async function editRoundClassArea(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof editRoundClassAreaInput>,
  meta: ClientMeta,
  now: Date,
): Promise<void> {
  assertCan(actor, 'round.manage');
  const input = parseInput(editRoundClassAreaInput, raw);
  await withTransaction(db, async (tx) => {
    const round = await repo.lockRound(tx, input.roundId);
    if (!round) throw notFound();
    if (round.status === 'scheduled') throw new AppError('VALIDATION', { message: ROUND_MSG.notOpened });
    if (round.status === 'finalized') throw new AppError('VALIDATION', { message: ROUND_MSG.finalized });
    const term = (await places.findTerm(tx, round.termId))!;
    if (!(await places.listTermClassIds(tx, term.id)).includes(input.classId))
      throw new AppError('VALIDATION', { field: 'classId', message: ROUND_MSG.classNotInTerm });
    const area = await places.findArea(tx, input.areaId);
    if (!area || area.type !== term.areaType || !area.isActive)
      throw new AppError('VALIDATION', { field: 'areaId', message: ROUND_MSG.wrongArea });
    const before = (await repo.listRoundClassAreas(tx, round.id)).find((r) => r.classId === input.classId) ?? null;
    if (before?.areaId === area.id) return;
    const row = { ...input, physicalRoomId: before?.physicalRoomId ?? null };
    await repo.upsertRoundClassArea(tx, row);
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'round_class_area.update',
        entity: 'round_class_area',
        entityId: `${round.id}:${input.classId}`,
        before,
        after: row,
        ip: meta.ip,
      },
      now,
    );
  });
}
