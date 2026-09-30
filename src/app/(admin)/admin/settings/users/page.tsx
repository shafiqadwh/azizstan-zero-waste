import { CircleCheck, CircleOff, KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import { requirePageUser } from '@/server/auth/current-user';
import { formatThaiDateTime } from '@/lib/dates';
import { getDb } from '@/server/db';
import { can } from '@/server/policies';
import { listUsers } from '@/server/services/user.service';
import { CreateUserForm } from './CreateUserForm';
import { AUTH_SOURCE_LABEL, ROLE_LABEL } from './labels';
import { UserRowActions } from './UserRowActions';

export const metadata: Metadata = { title: 'ผู้ใช้และสิทธิ์ · AZIZSTAN ZERO WASTE' };

/** 08-ux-ui §6.20 "ผู้ใช้และสิทธิ์": super admin manages; admins and executives see a read-only list (Q3, Q8). */
export default async function UsersPage() {
  const user = await requirePageUser('/admin/settings/users');
  const users = await listUsers(getDb(), user);
  const canManage = can(user, 'user.create');

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-8 lg:px-12">
      <div>
        <h1 className="text-[20px] leading-[1.3] font-bold lg:text-[26px]">ผู้ใช้และสิทธิ์</h1>
        <p className="mt-1 text-[14px] text-ink-muted">ทั้งหมด {users.length} บัญชี</p>
      </div>

      {canManage ? (
        <CreateUserForm />
      ) : (
        <p role="note" className="rounded-md bg-surface-muted px-4 py-3 text-[14px] text-ink">
          โหมดดูอย่างเดียว · เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่เพิ่มผู้ใช้ กำหนดสิทธิ์ เปิด/ปิดบัญชี และรีเซ็ตรหัสผ่านได้
        </p>
      )}

      {users.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center">ยังไม่มีผู้ใช้ในระบบ</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="รายชื่อผู้ใช้">
          {users.map((u) => (
            <li
              key={u.id}
              data-testid={`user-${u.username}`}
              className="grid gap-3 rounded-xl border border-line bg-surface p-4 lg:grid-cols-[1.2fr_1fr_1.8fr] lg:items-center"
            >
              <div>
                <p className="font-semibold">{u.displayName}</p>
                <p className="text-[14px] text-ink-muted">
                  {u.username} · {AUTH_SOURCE_LABEL[u.authSource]}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="rounded-full bg-brand-soft px-2.5 py-1 font-medium text-brand-ink">
                  {ROLE_LABEL[u.role]}
                </span>
                {u.isActive ? (
                  <span className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1">
                    <CircleCheck size={14} aria-hidden /> ใช้งาน
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-danger-ink">
                    <CircleOff size={14} aria-hidden /> ปิดใช้งาน
                  </span>
                )}
                {u.mustChangePassword ? (
                  <span className="flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 text-warn-ink">
                    <KeyRound size={14} aria-hidden /> ต้องเปลี่ยนรหัสผ่าน
                  </span>
                ) : null}
                <span className="w-full text-ink-muted">
                  เข้าสู่ระบบล่าสุด: {u.lastLoginAt ? formatThaiDateTime(u.lastLoginAt) : 'ยังไม่เคย'}
                </span>
              </div>
              {canManage && u.id !== user.id ? (
                <UserRowActions
                  userId={u.id}
                  username={u.username}
                  role={u.role}
                  isActive={u.isActive}
                  canResetPassword={u.authSource === 'local'}
                />
              ) : canManage ? (
                <p className="text-[13px] text-ink-muted">บัญชีของคุณ (เปลี่ยนสิทธิ์ตัวเองไม่ได้)</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
