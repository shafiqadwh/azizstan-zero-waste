'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { validation } from '@/server/errors';
import { toResult, type Result } from '@/server/result';
import {
  addClassAlias,
  linkClassRoom,
  removeClassAlias,
  setTermClasses,
  upsertArea,
  upsertClass,
  upsertPhysicalRoom,
} from '@/server/services/place.service';
import { importRooms, parseRoomsWorkbook, type ImportReport } from '@/server/services/rooms-import.service';

const PATH = '/admin/settings/classes';
export type ActionState = (Result<{ message: string }> & { seq: number }) | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const int = (f: FormData, k: string) => (str(f, k) === '' ? null : Number(str(f, k)));

async function run(prev: ActionState, fn: () => Promise<string>): Promise<ActionState> {
  const result = await toResult(async () => {
    const message = await fn();
    revalidatePath(PATH);
    return { message };
  });
  return { ...result, seq: (prev?.seq ?? 0) + 1 };
}

export async function saveTermClassesAction(prev: ActionState, form: FormData): Promise<ActionState> {
  return run(prev, async () => {
    const classIds = form.getAll('classId').map(String);
    await setTermClasses(
      getDb(),
      await requireUser(),
      { termId: str(form, 'termId'), classIds },
      await clientMeta(),
      new Date(),
    );
    return `บันทึกแล้ว ใช้ ${classIds.length} ห้องในภาคเรียนนี้`;
  });
}

export async function addClassAction(prev: ActionState, form: FormData): Promise<ActionState> {
  return run(prev, async () => {
    await upsertClass(
      getDb(),
      await requireUser(),
      {
        track: str(form, 'track') as never,
        gradeCode: str(form, 'gradeCode'),
        gradeLabel: str(form, 'gradeLabel'),
        rankGroup: str(form, 'rankGroup'),
        roomNo: int(form, 'roomNo') ?? 0,
        name: str(form, 'name'),
        displayName: str(form, 'displayName') || undefined,
      },
      await clientMeta(),
      new Date(),
    );
    return 'เพิ่มห้องเรียนแล้ว';
  });
}

export async function classRowAction(prev: ActionState, form: FormData): Promise<ActionState> {
  return run(prev, async () => {
    const user = await requireUser();
    const meta = await clientMeta();
    const now = new Date();
    const classId = str(form, 'classId');
    switch (str(form, 'intent')) {
      case 'alias-add':
        await addClassAlias(getDb(), user, { classId, alias: str(form, 'alias') }, meta, now);
        return 'เพิ่มชื่อเรียกแล้ว';
      case 'alias-remove':
        await removeClassAlias(getDb(), user, { aliasId: str(form, 'aliasId') }, meta, now);
        return 'ลบชื่อเรียกแล้ว';
      case 'move':
        await linkClassRoom(
          getDb(),
          user,
          { classId, physicalRoomId: str(form, 'physicalRoomId'), effectiveFrom: str(form, 'effectiveFrom') },
          meta,
          now,
        );
        return 'ย้ายห้องแล้ว';
      default:
        return '';
    }
  });
}

export async function addBuildingAction(prev: ActionState, form: FormData): Promise<ActionState> {
  return run(prev, async () => {
    const code = str(form, 'code');
    await upsertArea(
      getDb(),
      await requireUser(),
      { type: 'building', code, name: str(form, 'name') || `อาคาร ${code}`, sortOrder: Number(code) || 0 },
      await clientMeta(),
      new Date(),
    );
    return `เพิ่มอาคาร ${code} แล้ว`;
  });
}

export async function addRoomAction(prev: ActionState, form: FormData): Promise<ActionState> {
  return run(prev, async () => {
    const roomNumber = str(form, 'roomNumber');
    await upsertPhysicalRoom(
      getDb(),
      await requireUser(),
      { buildingId: str(form, 'buildingId'), roomNumber, floor: int(form, 'floor') },
      await clientMeta(),
      new Date(),
    );
    return `เพิ่มห้อง ${roomNumber} แล้ว`;
  });
}

export async function editRoomAction(prev: ActionState, form: FormData): Promise<ActionState> {
  return run(prev, async () => {
    const roomNumber = str(form, 'roomNumber');
    await upsertPhysicalRoom(
      getDb(),
      await requireUser(),
      {
        id: str(form, 'id'),
        buildingId: str(form, 'buildingId'),
        roomNumber,
        floor: int(form, 'floor'),
        isActive: form.get('isActive') === 'on',
      },
      await clientMeta(),
      new Date(),
    );
    return `บันทึกห้อง ${roomNumber} แล้ว`;
  });
}

export async function importRoomsAction(form: FormData): Promise<Result<ImportReport>> {
  return toResult(async () => {
    const user = await requireUser();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw validation('file', 'กรุณาเลือกไฟล์ rooms.xlsx');
    const rows = await parseRoomsWorkbook(await file.arrayBuffer());
    const report = await importRooms(
      getDb(),
      user,
      rows,
      { commit: form.get('commit') === '1' },
      await clientMeta(),
      new Date(),
    );
    if (report.committed) revalidatePath(PATH);
    return report;
  });
}
