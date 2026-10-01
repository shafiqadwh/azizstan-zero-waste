/**
 * Users and roles (FR-U1..U3, 05-api "Super admin" actions, T12). Only the super admin creates users, sets roles,
 * activates/deactivates and resets passwords (Q3, Q8). Admins and executives get a read-only list.
 */
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import { hashPassword } from '../auth/password.ts';
import { AppError, notFound, parseInput, validation } from '../errors.ts';
import { assertCan, assertStepUp, type Role, type SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/users.repository.ts';
import { withTransaction, type DbOrTx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';

export const ROLE_OPTIONS = ['super_admin', 'admin', 'executive', 'teacher'] as const satisfies readonly Role[];

export const USER_MSG = {
  usernameTaken: 'ชื่อผู้ใช้นี้มีอยู่แล้ว',
  usernameFormat: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a–z, 0–9, จุด ขีด และขีดล่าง (3–50 ตัว)',
  displayNameRequired: 'กรุณากรอกชื่อที่แสดง',
  notSelf: 'เปลี่ยนสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้',
  lastSuperAdmin: 'ต้องมีผู้ดูแลระบบสูงสุดที่ใช้งานได้อย่างน้อย 1 คน',
  schoolNoPassword: 'บัญชีโรงเรียนใช้รหัสผ่านของระบบโรงเรียน รีเซ็ตที่นี่ไม่ได้',
} as const;

const roleSchema = z.enum(ROLE_OPTIONS);

export const createUserInput = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,50}$/, USER_MSG.usernameFormat),
  displayName: z.string().trim().min(1, USER_MSG.displayNameRequired).max(100),
  role: roleSchema,
  authSource: z.enum(['local', 'school']).default('local'),
});
export const setRoleInput = z.object({ userId: z.uuid(), role: roleSchema });
export const setActiveInput = z.object({ userId: z.uuid(), active: z.boolean() });
export const resetPasswordInput = z.object({ userId: z.uuid() });

export interface UserListItem {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  authSource: 'local' | 'school';
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
}

/** Readable temporary password without look-alike characters (shown once, must be changed at first login). */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateTempPassword(length = 10): string {
  return Array.from({ length }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join('');
}

export async function listUsers(db: Db, actor: SessionUser): Promise<UserListItem[]> {
  assertCan(actor, 'staff.read');
  return repo.listUsers(db);
}

async function loadTarget(db: DbOrTx, userId: string) {
  const user = await repo.findUserById(db, userId);
  if (!user) throw notFound();
  return user;
}

export async function createUser(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof createUserInput>,
  meta: ClientMeta,
  now: Date,
): Promise<{ userId: string; tempPassword: string | null }> {
  assertCan(actor, 'user.create');
  assertStepUp(actor, now);
  const input = parseInput(createUserInput, raw);
  if (await repo.findUserByUsername(db, input.username)) throw validation('username', USER_MSG.usernameTaken);

  const tempPassword = input.authSource === 'local' ? generateTempPassword() : null;
  const passwordHash = tempPassword ? await hashPassword(tempPassword) : null;
  const id = newId();
  await withTransaction(db, async (tx) => {
    await repo.insertUser(tx, {
      id,
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      authSource: input.authSource,
      passwordHash,
      mustChangePassword: input.authSource === 'local',
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'user.create',
        entity: 'user',
        entityId: id,
        after: {
          username: input.username,
          displayName: input.displayName,
          role: input.role,
          authSource: input.authSource,
        },
        ip: meta.ip,
      },
      now,
    );
  });
  return { userId: id, tempPassword };
}

export async function setUserRole(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof setRoleInput>,
  meta: ClientMeta,
  now: Date,
): Promise<void> {
  assertCan(actor, 'user.setRole');
  assertStepUp(actor, now);
  const input = parseInput(setRoleInput, raw);
  if (input.userId === actor.id) throw new AppError('VALIDATION', { field: 'role', message: USER_MSG.notSelf });
  await withTransaction(db, async (tx) => {
    const target = await loadTarget(tx, input.userId);
    if (target.role === input.role) return;
    if (target.role === 'super_admin' && target.isActive && (await repo.countActiveSuperAdmins(tx)) <= 1) {
      throw new AppError('VALIDATION', { field: 'role', message: USER_MSG.lastSuperAdmin });
    }
    await repo.updateUser(tx, target.id, { role: input.role, updatedAt: now });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'user.set_role',
        entity: 'user',
        entityId: target.id,
        before: { role: target.role },
        after: { role: input.role },
        ip: meta.ip,
      },
      now,
    );
  });
}

export async function setUserActive(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof setActiveInput>,
  meta: ClientMeta,
  now: Date,
): Promise<void> {
  assertCan(actor, 'user.manage');
  assertStepUp(actor, now);
  const input = parseInput(setActiveInput, raw);
  if (input.userId === actor.id) throw new AppError('VALIDATION', { field: 'active', message: USER_MSG.notSelf });
  await withTransaction(db, async (tx) => {
    const target = await loadTarget(tx, input.userId);
    if (target.isActive === input.active) return;
    if (!input.active && target.role === 'super_admin' && (await repo.countActiveSuperAdmins(tx)) <= 1) {
      throw new AppError('VALIDATION', { field: 'active', message: USER_MSG.lastSuperAdmin });
    }
    await repo.updateUser(tx, target.id, { isActive: input.active, updatedAt: now });
    if (!input.active) await repo.deleteUserSessions(tx, target.id);
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: input.active ? 'user.activate' : 'user.deactivate',
        entity: 'user',
        entityId: target.id,
        before: { isActive: target.isActive },
        after: { isActive: input.active },
        ip: meta.ip,
      },
      now,
    );
  });
}

export async function resetUserPassword(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof resetPasswordInput>,
  meta: ClientMeta,
  now: Date,
): Promise<{ tempPassword: string }> {
  assertCan(actor, 'user.manage');
  assertStepUp(actor, now);
  const input = parseInput(resetPasswordInput, raw);
  const target = await loadTarget(db, input.userId);
  if (target.authSource !== 'local')
    throw new AppError('VALIDATION', { field: 'password', message: USER_MSG.schoolNoPassword });
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await withTransaction(db, async (tx) => {
    await repo.setPassword(tx, target.id, passwordHash, true, now);
    await repo.deleteUserSessions(tx, target.id);
    // The audit row records the reset, never the password or its hash.
    await writeAudit(
      tx,
      { actorId: actor.id, action: 'user.reset_password', entity: 'user', entityId: target.id, ip: meta.ip },
      now,
    );
  });
  return { tempPassword };
}
