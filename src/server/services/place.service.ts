/**
 * Places register (FR-P1..P3, FR-P7, T13): areas (buildings, zones), physical rooms, classes + aliases,
 * class ↔ room links with effective dates, and the per-term class selection.
 * Every mutation: policy → Zod → transaction → one audit row (AGENTS §5 rule 2).
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString } from '../../lib/dates/index.ts';
import { newId } from '../../lib/ids.ts';
import { classLookupKey } from '../../lib/scoring/classKey.ts';
import { AppError, notFound, parseInput, validation } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/places.repository.ts';
import { withTransaction, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';

export const PLACE_MSG = {
  areaCodeTaken: 'รหัสนี้มีอยู่แล้ว',
  roomNumberTaken: 'หมายเลขห้องนี้มีอยู่แล้ว',
  roomNumberFormat: 'หมายเลขห้องใช้ตัวเลขหรือตัวอักษร 1–10 ตัว',
  classTaken: 'มีห้องเรียนนี้อยู่แล้ว',
  aliasTaken: 'ชื่อนี้ใช้กับห้องเรียนอื่นแล้ว',
  aliasEmpty: 'กรุณากรอกชื่อที่ใช้ในข้อมูลนักเรียน',
  notBuilding: 'ห้องต้องอยู่ในอาคาร',
  dateFormat: 'วันที่ไม่ถูกต้อง (ปปปป-ดด-วว ปีคริสต์ศักราช)',
  sameRoom: 'ห้องเรียนนี้อยู่ห้องนี้อยู่แล้ว',
  laterMove: 'มีการย้ายห้องที่ตั้งไว้หลังวันที่นี้แล้ว แก้ที่รายการนั้นก่อน',
  roomBusy: (room: string, cls: string) => `ห้อง ${room} มี ${cls} ใช้อยู่ในวันที่นั้น ย้าย ${cls} ออกก่อน`,
  overlap: 'ช่วงวันที่ซ้อนกับการใช้ห้องที่มีอยู่ (ห้องเรียนหนึ่งใช้ได้ห้องเดียว และห้องหนึ่งมีห้องเรียนได้ห้องเดียว)',
  unknownClass: 'ไม่พบห้องเรียนที่เลือก',
} as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, PLACE_MSG.dateFormat)
  .refine(
    (s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    PLACE_MSG.dateFormat,
  );

export const areaInput = z.object({
  id: z.uuid().optional(),
  type: z.enum(['building', 'zone']),
  code: z.string().trim().min(1, 'กรุณากรอกรหัส').max(10),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const roomInput = z.object({
  id: z.uuid().optional(),
  buildingId: z.uuid(),
  roomNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{1,10}$/, PLACE_MSG.roomNumberFormat),
  floor: z.number().int().min(0).max(20).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const classInput = z.object({
  id: z.uuid().optional(),
  track: z.enum(['general', 'religious', 'vocational']),
  gradeCode: z.string().trim().min(1).max(20),
  gradeLabel: z.string().trim().min(1, 'กรุณากรอกระดับชั้น').max(40),
  rankGroup: z.string().trim().min(1, 'กรุณากรอกกลุ่มจัดอันดับ').max(40),
  roomNo: z.number().int().min(0).max(99),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อห้องเรียน').max(60),
  displayName: z.string().trim().max(80).optional(),
  isActive: z.boolean().default(true),
});

export const aliasInput = z.object({
  classId: z.uuid(),
  alias: z.string().trim().min(1, PLACE_MSG.aliasEmpty).max(100),
});
export const linkInput = z.object({ classId: z.uuid(), physicalRoomId: z.uuid(), effectiveFrom: isoDate });
export const termClassesInput = z.object({ termId: z.uuid(), classIds: z.array(z.uuid()).max(500) });

/** FR-P1 display: general "ม.1 Amanah", vocational "ปวช.2/1" (name already carries it), religious "{grade} {name}". */
export function defaultDisplayName(c: { track: string; gradeLabel: string; name: string }): string {
  return c.track === 'vocational' ? c.name : `${c.gradeLabel} ${c.name}`;
}

/** FR-P7 / BR-TM1: which classes a new term inherits. Same academic year → the previous selection; new year → none. */
export function classSelectionToCopy(
  previous: { academicYear: number },
  next: { academicYear: number },
  previousSelection: readonly string[],
): string[] {
  return previous.academicYear === next.academicYear ? [...previousSelection] : [];
}

/** Postgres exclusion-constraint violation (FR-P3 overlap) → Thai validation message. */
function isExclusionViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23P01' || e?.cause?.code === '23P01';
}

async function audit(
  tx: Tx,
  actor: SessionUser,
  meta: ClientMeta,
  now: Date,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  await writeAudit(tx, { actorId: actor.id, action, entity, entityId, before, after, ip: meta.ip }, now);
}

// ───────────── reads ─────────────

export interface PlacesOverview {
  today: string;
  areas: repo.AreaRow[];
  rooms: (repo.RoomRow & { buildingCode: string | null; currentClassId: string | null })[];
  classes: (repo.ClassRow & {
    aliases: { id: string; alias: string }[];
    currentRoomId: string | null;
    currentRoomNumber: string | null;
    /** The next planned move, if any (a link starting after today). */
    nextRoom: { roomNumber: string; effectiveFrom: string } | null;
  })[];
}

export async function getPlaces(db: Db, actor: SessionUser, now: Date): Promise<PlacesOverview> {
  assertCan(actor, 'staff.read');
  const today = bangkokDateString(now);
  const [areas, rooms, classes, aliases, links, upcoming] = await Promise.all([
    repo.listAreas(db),
    repo.listRooms(db),
    repo.listClasses(db),
    repo.listAliases(db),
    repo.listLinksOnDate(db, today),
    repo.upcomingLinks(db, today),
  ]);
  const buildingCode = new Map(areas.map((a) => [a.id, a.code]));
  const roomNumber = new Map(rooms.map((r) => [r.id, r.roomNumber]));
  const classInRoom = new Map(links.map((l) => [l.physicalRoomId, l.classId]));
  const roomOfClass = new Map(links.map((l) => [l.classId, l.physicalRoomId]));
  return {
    today,
    areas,
    rooms: rooms.map((r) => ({
      ...r,
      buildingCode: buildingCode.get(r.buildingId) ?? null,
      currentClassId: classInRoom.get(r.id) ?? null,
    })),
    classes: classes.map((c) => {
      const roomId = roomOfClass.get(c.id) ?? null;
      return {
        ...c,
        aliases: aliases.filter((a) => a.classId === c.id).map((a) => ({ id: a.id, alias: a.alias })),
        currentRoomId: roomId,
        currentRoomNumber: roomId ? (roomNumber.get(roomId) ?? null) : null,
        nextRoom: (() => {
          const next = upcoming.find((l) => l.classId === c.id);
          return next
            ? { roomNumber: roomNumber.get(next.physicalRoomId) ?? '', effectiveFrom: next.effectiveFrom }
            : null;
        })(),
      };
    }),
  };
}

// ───────────── areas, rooms, classes ─────────────

export async function upsertArea(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof areaInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'place.manage');
  const input = parseInput(areaInput, raw);
  return withTransaction(db, async (tx) => {
    const clash = await repo.findAreaByCode(tx, input.type, input.code);
    if (clash && clash.id !== input.id) throw validation('code', PLACE_MSG.areaCodeTaken);
    const fields = {
      type: input.type,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    };
    if (input.id) {
      const before = await repo.findArea(tx, input.id);
      if (!before) throw notFound();
      await repo.updateArea(tx, input.id, fields);
      await audit(tx, actor, meta, now, 'area.update', 'area', input.id, before, fields);
      return input.id;
    }
    const id = newId();
    await repo.insertArea(tx, { id, ...fields });
    await audit(tx, actor, meta, now, 'area.create', 'area', id, undefined, fields);
    return id;
  });
}

export async function upsertPhysicalRoom(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof roomInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'place.manage');
  const input = parseInput(roomInput, raw);
  return withTransaction(db, async (tx) => {
    const building = await repo.findArea(tx, input.buildingId);
    if (!building || building.type !== 'building') throw validation('buildingId', PLACE_MSG.notBuilding);
    const clash = await repo.findRoomByNumber(tx, input.roomNumber);
    if (clash && clash.id !== input.id) throw validation('roomNumber', PLACE_MSG.roomNumberTaken);
    const fields = {
      buildingId: input.buildingId,
      roomNumber: input.roomNumber,
      floor: input.floor ?? null,
      isActive: input.isActive,
    };
    if (input.id) {
      const before = await repo.findRoom(tx, input.id);
      if (!before) throw notFound();
      await repo.updateRoom(tx, input.id, fields);
      await audit(tx, actor, meta, now, 'room.update', 'physical_room', input.id, before, fields);
      return input.id;
    }
    const id = newId();
    // QR on the door → /r/{qrToken} (Q6); random so room numbers cannot be guessed into URLs.
    await repo.insertRoom(tx, { id, ...fields, qrToken: randomBytes(16).toString('base64url') });
    await audit(tx, actor, meta, now, 'room.create', 'physical_room', id, undefined, fields);
    return id;
  });
}

export async function upsertClass(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof classInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'place.manage');
  const input = parseInput(classInput, raw);
  const displayName = input.displayName || defaultDisplayName(input);
  return withTransaction(db, async (tx) => {
    const clash = await repo.findClassByKey(tx, input.track, input.gradeCode, input.name);
    if (clash && clash.id !== input.id) throw validation('name', PLACE_MSG.classTaken);
    const fields = {
      track: input.track,
      gradeCode: input.gradeCode,
      gradeLabel: input.gradeLabel,
      rankGroup: input.rankGroup,
      roomNo: input.roomNo,
      name: input.name,
      displayName,
      isActive: input.isActive,
    };
    if (input.id) {
      const before = await repo.findClass(tx, input.id);
      if (!before) throw notFound();
      await repo.updateClass(tx, input.id, fields);
      await audit(tx, actor, meta, now, 'class.update', 'class', input.id, before, fields);
      return input.id;
    }
    const id = newId();
    await repo.insertClass(tx, { id, ...fields });
    await audit(tx, actor, meta, now, 'class.create', 'class', id, undefined, fields);
    return id;
  });
}

/** Aliases are stored as lookup keys (business rules §9.2), so "ม.1/10 Usaha(Ijtihad)" and its variants resolve. */
export async function addClassAlias(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof aliasInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'place.manage');
  const input = parseInput(aliasInput, raw);
  const key = classLookupKey(input.alias);
  if (!key) throw validation('alias', PLACE_MSG.aliasEmpty);
  return withTransaction(db, async (tx) => {
    if (!(await repo.findClass(tx, input.classId))) throw notFound();
    const existing = await repo.findAlias(tx, key);
    if (existing) {
      if (existing.classId === input.classId) return existing.id;
      throw validation('alias', PLACE_MSG.aliasTaken);
    }
    const id = newId();
    await repo.insertAlias(tx, { id, classId: input.classId, alias: key });
    await audit(tx, actor, meta, now, 'class.alias_add', 'class', input.classId, undefined, { alias: key });
    return id;
  });
}

export async function removeClassAlias(
  db: Db,
  actor: SessionUser,
  raw: { aliasId: string },
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'place.manage');
  const { aliasId } = parseInput(z.object({ aliasId: z.uuid() }), raw);
  await withTransaction(db, async (tx) => {
    const removed = await repo.deleteAlias(tx, aliasId);
    if (!removed) throw notFound();
    await audit(tx, actor, meta, now, 'class.alias_remove', 'class', removed.classId, { alias: removed.alias });
  });
}

// ───────────── class ↔ room links (FR-P3) ─────────────

/**
 * Put a class in a room from `effectiveFrom`. The class's current link is closed on that date (the end date is
 * exclusive), so the history stays: "moving a class closes the old link at the effective date". A link that
 * starts on the same date is replaced. The room must be free on that date.
 */
export async function linkClassRoom(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof linkInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'place.manage');
  const input = parseInput(linkInput, raw);
  return withTransaction(db, (tx) => linkInTx(tx, actor, input, meta, now));
}

/** linkClassRoom inside an existing transaction (also used by the rooms.xlsx import). Caller checks the policy. */
export async function linkInTx(
  tx: Tx,
  actor: SessionUser,
  input: z.output<typeof linkInput>,
  meta: ClientMeta,
  now: Date,
): Promise<string> {
  const cls = await repo.findClass(tx, input.classId);
  const room = await repo.findRoom(tx, input.physicalRoomId);
  if (!cls || !room) throw notFound();

  if ((await repo.laterLinks(tx, { classId: cls.id }, input.effectiveFrom)).length > 0) {
    throw validation('effectiveFrom', PLACE_MSG.laterMove);
  }
  const occupant = await repo.linkOfRoomOnDate(tx, room.id, input.effectiveFrom);
  if (occupant && occupant.classId !== cls.id) {
    const other = await repo.findClass(tx, occupant.classId);
    throw validation('physicalRoomId', PLACE_MSG.roomBusy(room.roomNumber, other?.displayName ?? ''));
  }
  const current = await repo.linkOfClassOnDate(tx, cls.id, input.effectiveFrom);
  if (current?.physicalRoomId === room.id) throw validation('physicalRoomId', PLACE_MSG.sameRoom);
  if (current) {
    if (current.effectiveFrom === input.effectiveFrom) await repo.deleteLink(tx, current.id);
    else await repo.closeLink(tx, current.id, input.effectiveFrom);
  }
  const id = newId();
  try {
    // Savepoint: a constraint violation must not poison the caller's transaction.
    await tx.transaction((sp) =>
      repo.insertLink(sp, {
        id,
        classId: cls.id,
        physicalRoomId: room.id,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: null,
        createdBy: actor.id,
      }),
    );
  } catch (err) {
    // Defence in depth: the DB exclusion constraints (RAW_SQL) still reject any overlap the checks above missed.
    if (isExclusionViolation(err)) throw validation('effectiveFrom', PLACE_MSG.overlap);
    throw err;
  }
  await audit(
    tx,
    actor,
    meta,
    now,
    'class.move',
    'class',
    cls.id,
    current ? { roomId: current.physicalRoomId, effectiveFrom: current.effectiveFrom } : undefined,
    { roomId: room.id, roomNumber: room.roomNumber, effectiveFrom: input.effectiveFrom },
  );
  return id;
}

// ───────────── per-term class selection (FR-P7) ─────────────

export async function getTermClassIds(db: Db, actor: SessionUser, termId: string): Promise<string[]> {
  assertCan(actor, 'staff.read');
  return repo.listTermClassIds(db, termId);
}

/** Replace the term's class selection. Locked together with the term config (BR-TM2). */
export async function setTermClasses(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof termClassesInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'term.configure');
  const input = parseInput(termClassesInput, raw);
  const ids = [...new Set(input.classIds)];
  await withTransaction(db, async (tx) => {
    const term = await repo.findTerm(tx, input.termId);
    if (!term) throw notFound();
    if (term.configLockedAt) throw new AppError('CONFIG_LOCKED');
    if ((await repo.countExistingClasses(tx, ids)) !== ids.length) throw validation('classIds', PLACE_MSG.unknownClass);
    const before = await repo.listTermClassIds(tx, term.id);
    await repo.replaceTermClasses(tx, term.id, ids);
    await audit(
      tx,
      actor,
      meta,
      now,
      'term.set_classes',
      'term',
      term.id,
      { count: before.length },
      { count: ids.length, classIds: ids },
    );
  });
}

/** The active term and its class selection, for the settings page (null when no term is active yet). */
export async function getActiveTermSelection(db: Db, actor: SessionUser) {
  assertCan(actor, 'staff.read');
  const term = await repo.findActiveTerm(db);
  if (!term) return null;
  return { term, classIds: await repo.listTermClassIds(db, term.id) };
}
