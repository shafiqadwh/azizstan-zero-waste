'use server';

import { revalidatePath } from 'next/cache';
import { clientMeta, requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toResult, type Result } from '@/server/result';
import {
  addClassAlias,
  removeClassAlias,
  setTermClasses,
  upsertArea,
  upsertClass,
} from '@/server/services/place.service';

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
    const areas = classIds.flatMap((classId) => {
      const areaId = str(form, `area:${classId}`);
      return areaId ? [{ classId, areaId }] : [];
    });
    await setTermClasses(
      getDb(),
      await requireUser(),
      { termId: str(form, 'termId'), classIds, areas },
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
