/**
 * duties.xlsx import (10-integrations §4.1, FR-U9): username | ชื่อ | หน้าที่ | ประเภทเป้าหมาย | เป้าหมาย.
 * Like rooms.xlsx, dry-run and commit run the same code in one transaction; a dry-run or any row error rolls
 * everything back, so the report is exactly what the commit will do.
 */
import ExcelJS from 'exceljs';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString } from '../../lib/dates/index.ts';
import { classLookupKey } from '../../lib/scoring/classKey.ts';
import { AppError } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { withTransaction, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { assignInTx, notifyDutyAssigned } from './duty.service.ts';
import { cellText, MAX_IMPORT_BYTES } from './rooms-import.service.ts';

export const DUTY_HEADERS = ['username', 'ชื่อ', 'หน้าที่', 'ประเภทเป้าหมาย', 'เป้าหมาย'] as const;

export interface DutyImportRow {
  line: number;
  username: string;
  duty: string;
  targetType: string;
  target: string;
}

export interface DutyRowResult {
  line: number;
  username: string;
  target: string;
  action: string | null;
  error: string | null;
}

export interface DutyImportReport {
  committed: boolean;
  rows: DutyRowResult[];
  summary: { created: number; existing: number; enabledUsers: number; errors: number };
  /** Classes / areas of the term that would still have no committee member after this import. */
  uncovered: string[];
}

export const DUTY_IMPORT_MSG = {
  badFile: 'อ่านไฟล์ไม่ได้ กรุณาใช้แม่แบบ duties.xlsx',
  tooBig: 'ไฟล์ใหญ่เกิน 2 MB',
  missingHeader: (h: string) => `ไม่พบคอลัมน์ "${h}" ในแถวแรก`,
  empty: 'ไม่มีข้อมูลในไฟล์',
  usernameRequired: 'ไม่มี username',
  unknownUser: (u: string) => `ไม่พบผู้ใช้ "${u}"`,
  unknownDuty: (d: string) => `ไม่รู้จักหน้าที่ "${d}" (ใช้ committee หรือ approver)`,
  unknownType: (t: string) => `ไม่รู้จักประเภทเป้าหมาย "${t}" (ใช้ ห้อง โซน หรือ อาคาร)`,
  targetRequired: 'กรรมการต้องระบุเป้าหมาย',
  unknownTarget: (t: string) => `ไม่พบเป้าหมาย "${t}"`,
  duplicate: (line: number) => `ซ้ำกับแถว ${line}`,
} as const;

export async function parseDutiesWorkbook(data: ArrayBuffer): Promise<DutyImportRow[]> {
  if (data.byteLength > MAX_IMPORT_BYTES)
    throw new AppError('VALIDATION', { field: 'file', message: DUTY_IMPORT_MSG.tooBig });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new AppError('VALIDATION', { field: 'file', message: DUTY_IMPORT_MSG.badFile });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('VALIDATION', { field: 'file', message: DUTY_IMPORT_MSG.badFile });
  const col = new Map<string, number>();
  ws.getRow(1).eachCell((cell, i) => {
    const text = cellText(cell.value).toLowerCase();
    const match = DUTY_HEADERS.find((h) => text.startsWith(h));
    if (match && !col.has(match)) col.set(match, i);
  });
  for (const h of ['username', 'หน้าที่', 'ประเภทเป้าหมาย', 'เป้าหมาย'] as const) {
    if (!col.has(h)) throw new AppError('VALIDATION', { field: 'file', message: DUTY_IMPORT_MSG.missingHeader(h) });
  }
  const get = (row: ExcelJS.Row, h: (typeof DUTY_HEADERS)[number]) => cellText(row.getCell(col.get(h)!).value);
  const rows: DutyImportRow[] = [];
  ws.eachRow((row, line) => {
    if (line === 1) return;
    const r = {
      line,
      username: get(row, 'username'),
      duty: get(row, 'หน้าที่'),
      targetType: get(row, 'ประเภทเป้าหมาย'),
      target: get(row, 'เป้าหมาย'),
    };
    if (r.username || r.duty || r.targetType || r.target) rows.push(r);
  });
  if (rows.length === 0) throw new AppError('VALIDATION', { field: 'file', message: DUTY_IMPORT_MSG.empty });
  return rows;
}

const DUTY_WORDS: Record<string, 'committee' | 'approver' | 'area_teacher'> = {
  committee: 'committee',
  กรรมการ: 'committee',
  approver: 'approver',
  ผู้อนุมัติ: 'approver',
  area_teacher: 'area_teacher',
  ครูผู้รับผิดชอบ: 'area_teacher',
  ครูผู้รับผิดชอบพื้นที่: 'area_teacher',
};
const DUTY_LABEL = { committee: 'กรรมการ', approver: 'ผู้อนุมัติ', area_teacher: 'ครูผู้รับผิดชอบพื้นที่' } as const;
const TYPE_WORDS: Record<string, 'class' | 'zone' | 'building'> = {
  ห้อง: 'class',
  ห้องเรียน: 'class',
  class: 'class',
  โซน: 'zone',
  zone: 'zone',
  อาคาร: 'building',
  building: 'building',
};

export const parseDutyWord = (s: string) => DUTY_WORDS[s.trim().toLowerCase()] ?? null;
export const parseTargetTypeWord = (s: string) => TYPE_WORDS[s.trim().toLowerCase()] ?? null;

/** "เป้าหมาย" for rooms: a room number (the class in it today) or a class name / alias. Areas: code or name. */
async function resolveTarget(
  tx: Tx,
  kind: 'class' | 'zone' | 'building',
  text: string,
  today: string,
): Promise<{ targetType: 'class' | 'area'; targetId: string } | null> {
  if (kind === 'class') {
    const room = await places.findRoomByNumber(tx, text);
    if (room) {
      const link = await places.linkOfRoomOnDate(tx, room.id, today);
      return link ? { targetType: 'class', targetId: link.classId } : null;
    }
    const cls = await places.findClassByAliasOrDisplay(tx, classLookupKey(text), text);
    return cls ? { targetType: 'class', targetId: cls.id } : null;
  }
  const byCode = await places.findAreaByCode(tx, kind, text);
  if (byCode) return { targetType: 'area', targetId: byCode.id };
  const byName = (await places.listAreas(tx)).find((a) => a.type === kind && a.name === text);
  return byName ? { targetType: 'area', targetId: byName.id } : null;
}

/** Selected classes and term areas with no committee duty in force. */
async function uncoveredTargets(tx: Tx, termId: string, now: Date): Promise<string[]> {
  const term = (await places.findTerm(tx, termId))!;
  // one connection inside a transaction: run the reads one after another
  const classes = await places.listClasses(tx);
  const areas = await places.listAreas(tx);
  const selected = await places.listTermClassIds(tx, termId);
  const duties = await dutiesRepo.listTermDuties(tx, termId);
  const covered = new Set(
    duties
      .filter((d) => d.duty === 'committee' && (d.validUntil === null || d.validUntil > now))
      .map((d) => d.targetClassId ?? d.targetAreaId),
  );
  const chosen = new Set(selected);
  return [
    ...classes.filter((c) => chosen.has(c.id) && !covered.has(c.id)).map((c) => c.displayName),
    ...areas.filter((a) => a.type === term.areaType && a.isActive && !covered.has(a.id)).map((a) => a.name),
  ];
}

class Rollback extends Error {}

export async function importDuties(
  db: Db,
  actor: SessionUser,
  termId: string,
  rows: DutyImportRow[],
  opts: { commit: boolean },
  meta: ClientMeta,
  now: Date,
): Promise<DutyImportReport> {
  assertCan(actor, 'duty.manage');
  const today = bangkokDateString(now);
  const results: DutyRowResult[] = [];
  const summary = { created: 0, existing: 0, enabledUsers: 0, errors: 0 };
  let uncovered: string[] = [];
  let committed = false;

  try {
    await withTransaction(db, async (tx) => {
      if (!(await places.findTerm(tx, termId))) throw new AppError('NOT_FOUND');
      const seen = new Map<string, number>();
      const notifyUsers: string[] = [];
      for (const row of rows) {
        const base = { line: row.line, username: row.username, target: row.target };
        const fail = (error: string) => results.push({ ...base, action: null, error });
        if (!row.username) {
          fail(DUTY_IMPORT_MSG.usernameRequired);
          continue;
        }
        const user = await usersRepo.findUserByUsername(tx, row.username);
        if (!user) {
          fail(DUTY_IMPORT_MSG.unknownUser(row.username));
          continue;
        }
        const duty = parseDutyWord(row.duty);
        if (!duty) {
          fail(DUTY_IMPORT_MSG.unknownDuty(row.duty));
          continue;
        }
        let target: Awaited<ReturnType<typeof resolveTarget>> = null;
        if (row.target || row.targetType) {
          const kind = parseTargetTypeWord(row.targetType);
          if (!kind) {
            fail(DUTY_IMPORT_MSG.unknownType(row.targetType));
            continue;
          }
          target = row.target ? await resolveTarget(tx, kind, row.target, today) : null;
          if (!target) {
            fail(row.target ? DUTY_IMPORT_MSG.unknownTarget(row.target) : DUTY_IMPORT_MSG.targetRequired);
            continue;
          }
        } else if (duty !== 'approver') {
          fail(DUTY_IMPORT_MSG.targetRequired);
          continue;
        }
        const key = `${user.id}|${duty}|${target?.targetId ?? '*'}`;
        const first = seen.get(key);
        if (first !== undefined) {
          fail(DUTY_IMPORT_MSG.duplicate(first));
          continue;
        }
        seen.set(key, row.line);
        try {
          const outcome = await tx.transaction((sp) =>
            assignInTx(
              sp,
              actor,
              {
                termId,
                userId: user.id,
                duty,
                targetType: target?.targetType ?? null,
                targetId: target?.targetId ?? null,
              },
              meta,
              now,
              { allowExisting: true },
            ),
          );
          if (outcome.created) {
            summary.created++;
            if (duty === 'committee') notifyUsers.push(user.id);
          } else summary.existing++;
          if (outcome.enabledUser) summary.enabledUsers++;
          const action = outcome.created
            ? `มอบหมาย${DUTY_LABEL[duty]}${outcome.enabledUser ? ' · เปิดบัญชี' : ''}`
            : 'มอบหมายไว้แล้ว';
          results.push({ ...base, action, error: null });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          fail(err.message);
        }
      }
      summary.errors = results.filter((r) => r.error).length;
      uncovered = await uncoveredTargets(tx, termId, now);
      if (!opts.commit || summary.errors > 0) throw new Rollback();
      await notifyDutyAssigned(tx, termId, notifyUsers, now);
      await writeAudit(
        tx,
        {
          actorId: actor.id,
          action: 'duties.import',
          entity: 'import',
          entityId: 'duties.xlsx',
          after: { termId, ...summary },
          ip: meta.ip,
        },
        now,
      );
      committed = true;
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return { committed, rows: results, summary, uncovered };
}
