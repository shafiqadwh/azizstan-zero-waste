/**
 * rooms.xlsx import (10-integrations §4.2): อาคาร | หมายเลขห้อง | ชั้น | ห้องเรียน (optional) | มีผลตั้งแต่.
 * Dry-run and commit run the very same code inside one transaction; a dry-run (or any row error) rolls it all back,
 * so the report the admin reads is exactly what the commit will do.
 */
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import { classLookupKey } from '../../lib/scoring/classKey.ts';
import { AppError } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/places.repository.ts';
import { withTransaction, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { linkInTx, PLACE_MSG } from './place.service.ts';

export const HEADERS = ['อาคาร', 'หมายเลขห้อง', 'ชั้น', 'ห้องเรียน', 'มีผลตั้งแต่'] as const;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface ImportRow {
  line: number; // spreadsheet row number, for the report
  building: string;
  roomNumber: string;
  floor: number | null;
  classText: string | null;
  effectiveFrom: string | null;
}

export interface RowResult {
  line: number;
  roomNumber: string;
  actions: string[];
  error: string | null;
}

export interface ImportReport {
  committed: boolean;
  rows: RowResult[];
  summary: { buildingsCreated: number; roomsCreated: number; roomsUpdated: number; links: number; errors: number };
}

const IMPORT_MSG = {
  badFile: 'อ่านไฟล์ไม่ได้ กรุณาใช้แม่แบบ rooms.xlsx',
  tooBig: 'ไฟล์ใหญ่เกิน 2 MB',
  missingHeader: (h: string) => `ไม่พบคอลัมน์ "${h}" ในแถวแรก`,
  empty: 'ไม่มีข้อมูลในไฟล์',
  buildingRequired: 'ไม่มีรหัสอาคาร',
  roomRequired: 'ไม่มีหมายเลขห้อง',
  duplicateRoom: (n: string) => `หมายเลขห้อง ${n} ซ้ำในไฟล์`,
  duplicateClass: (c: string) => `${c} อยู่หลายแถวในไฟล์`,
  unknownClass: (c: string) => `ไม่พบห้องเรียน "${c}" (เพิ่มชื่อเรียกอื่นในหน้าห้องเรียนก่อน)`,
  dateRequired: 'ต้องระบุวันที่มีผลเมื่อผูกห้องเรียน',
  hasErrors: 'มีแถวที่ผิดพลาด ยังไม่ได้นำเข้า แก้ไฟล์แล้วลองอีกครั้ง',
} as const;

class Rollback extends Error {}

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return String(v).trim();
}

/** Excel dates arrive as Date (UTC midnight) or as text; accept yyyy-mm-dd and dd/mm/yyyy (พ.ศ. or ค.ศ.). */
export function normalizeDate(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  if (y > 2400) y -= 543; // Buddhist era
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso) ? iso : null;
}

export async function parseRoomsWorkbook(data: ArrayBuffer): Promise<ImportRow[]> {
  if (data.byteLength > MAX_IMPORT_BYTES)
    throw new AppError('VALIDATION', { field: 'file', message: IMPORT_MSG.tooBig });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new AppError('VALIDATION', { field: 'file', message: IMPORT_MSG.badFile });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('VALIDATION', { field: 'file', message: IMPORT_MSG.badFile });
  const headerRow = ws.getRow(1);
  const col = new Map<string, number>();
  headerRow.eachCell((cell, i) => {
    const text = cellText(cell.value);
    const match = HEADERS.find((h) => text.startsWith(h));
    if (match && !col.has(match)) col.set(match, i);
  });
  for (const h of ['อาคาร', 'หมายเลขห้อง'] as const) {
    if (!col.has(h)) throw new AppError('VALIDATION', { field: 'file', message: IMPORT_MSG.missingHeader(h) });
  }
  const get = (row: ExcelJS.Row, h: (typeof HEADERS)[number]) =>
    col.has(h) ? cellText(row.getCell(col.get(h)!).value) : '';
  const rows: ImportRow[] = [];
  ws.eachRow((row, line) => {
    if (line === 1) return;
    const building = get(row, 'อาคาร');
    const roomNumber = get(row, 'หมายเลขห้อง');
    const classText = get(row, 'ห้องเรียน') || null;
    const floorText = get(row, 'ชั้น');
    const dateText = get(row, 'มีผลตั้งแต่');
    if (!building && !roomNumber && !classText) return; // blank line
    rows.push({
      line,
      building,
      roomNumber,
      floor: floorText && /^\d+$/.test(floorText) ? Number(floorText) : null,
      classText,
      effectiveFrom: dateText ? (normalizeDate(dateText) ?? `invalid:${dateText}`) : null,
    });
  });
  if (rows.length === 0) throw new AppError('VALIDATION', { field: 'file', message: IMPORT_MSG.empty });
  return rows;
}

async function applyRow(
  tx: Tx,
  actor: SessionUser,
  row: ImportRow,
  meta: ClientMeta,
  now: Date,
  s: ImportReport['summary'],
) {
  const actions: string[] = [];
  let building = await repo.findAreaByCode(tx, 'building', row.building);
  if (!building) {
    const id = newId();
    await repo.insertArea(tx, {
      id,
      type: 'building',
      code: row.building,
      name: `อาคาร ${row.building}`,
      sortOrder: Number(row.building) || 0,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'area.create',
        entity: 'area',
        entityId: id,
        after: { code: row.building, via: 'rooms.xlsx' },
        ip: meta.ip,
      },
      now,
    );
    building = (await repo.findArea(tx, id))!;
    actions.push(`เพิ่มอาคาร ${row.building}`);
    s.buildingsCreated++;
  }
  let room = await repo.findRoomByNumber(tx, row.roomNumber);
  if (!room) {
    const id = newId();
    await repo.insertRoom(tx, {
      id,
      buildingId: building.id,
      roomNumber: row.roomNumber,
      floor: row.floor,
      qrToken: randomBytes(16).toString('base64url'),
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'room.create',
        entity: 'physical_room',
        entityId: id,
        after: { roomNumber: row.roomNumber, via: 'rooms.xlsx' },
        ip: meta.ip,
      },
      now,
    );
    room = (await repo.findRoom(tx, id))!;
    actions.push(`เพิ่มห้อง ${row.roomNumber}`);
    s.roomsCreated++;
  } else if (room.buildingId !== building.id || (row.floor !== null && room.floor !== row.floor)) {
    const patch = { buildingId: building.id, floor: row.floor ?? room.floor };
    await repo.updateRoom(tx, room.id, patch);
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'room.update',
        entity: 'physical_room',
        entityId: room.id,
        before: room,
        after: { ...patch, via: 'rooms.xlsx' },
        ip: meta.ip,
      },
      now,
    );
    actions.push(`แก้ข้อมูลห้อง ${row.roomNumber}`);
    s.roomsUpdated++;
  }
  if (row.classText) {
    const cls = await repo.findClassByAliasOrDisplay(tx, classLookupKey(row.classText), row.classText);
    if (!cls) throw new AppError('VALIDATION', { message: IMPORT_MSG.unknownClass(row.classText) });
    if (!row.effectiveFrom) throw new AppError('VALIDATION', { message: IMPORT_MSG.dateRequired });
    if (row.effectiveFrom.startsWith('invalid:')) throw new AppError('VALIDATION', { message: PLACE_MSG.dateFormat });
    const current = await repo.linkOfClassOnDate(tx, cls.id, row.effectiveFrom);
    if (current?.physicalRoomId !== room.id) {
      await linkInTx(
        tx,
        actor,
        { classId: cls.id, physicalRoomId: room.id, effectiveFrom: row.effectiveFrom },
        meta,
        now,
      );
      actions.push(`ผูก ${cls.displayName} ตั้งแต่ ${row.effectiveFrom}`);
      s.links++;
    }
  }
  if (actions.length === 0) actions.push('ไม่มีการเปลี่ยนแปลง');
  return actions;
}

export async function importRooms(
  db: Db,
  actor: SessionUser,
  rows: ImportRow[],
  opts: { commit: boolean },
  meta: ClientMeta,
  now: Date,
): Promise<ImportReport> {
  assertCan(actor, 'place.manage');
  const results: RowResult[] = [];
  const summary = { buildingsCreated: 0, roomsCreated: 0, roomsUpdated: 0, links: 0, errors: 0 };

  // Problems inside the file itself are reported before touching the database.
  const seenRooms = new Map<string, number>();
  const seenClasses = new Map<string, number>();
  const fileError = new Map<number, string>();
  for (const r of rows) {
    if (!r.building) fileError.set(r.line, IMPORT_MSG.buildingRequired);
    else if (!r.roomNumber) fileError.set(r.line, IMPORT_MSG.roomRequired);
    else if (seenRooms.has(r.roomNumber)) fileError.set(r.line, IMPORT_MSG.duplicateRoom(r.roomNumber));
    else if (r.classText && seenClasses.has(classLookupKey(r.classText) ?? r.classText))
      fileError.set(r.line, IMPORT_MSG.duplicateClass(r.classText));
    seenRooms.set(r.roomNumber, r.line);
    if (r.classText) seenClasses.set(classLookupKey(r.classText) ?? r.classText, r.line);
  }

  let committed = false;
  try {
    await withTransaction(db, async (tx) => {
      for (const row of rows) {
        const pre = fileError.get(row.line);
        if (pre) {
          results.push({ line: row.line, roomNumber: row.roomNumber, actions: [], error: pre });
          continue;
        }
        try {
          const actions = await tx.transaction((sp) => applyRow(sp, actor, row, meta, now, summary));
          results.push({ line: row.line, roomNumber: row.roomNumber, actions, error: null });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          results.push({ line: row.line, roomNumber: row.roomNumber, actions: [], error: err.message });
        }
      }
      summary.errors = results.filter((r) => r.error).length;
      if (!opts.commit || summary.errors > 0) throw new Rollback();
      await writeAudit(
        tx,
        {
          actorId: actor.id,
          action: 'rooms.import',
          entity: 'import',
          entityId: 'rooms.xlsx',
          after: summary,
          ip: meta.ip,
        },
        now,
      );
      committed = true;
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return { committed, rows: results, summary };
}

export { IMPORT_MSG };
