/**
 * Authorization (06-auth §2–3): decision = role + duty. Role-only rules are answered here; duty, ownership and
 * approver checks arrive through `ctx`, resolved by the calling service.
 */
import { forbidden } from '../errors.ts';

export type Role = 'super_admin' | 'admin' | 'executive' | 'teacher';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  authSource: 'local' | 'school';
  mustChangePassword: boolean;
  sessionId: string;
}

export type Action =
  | 'public.read'
  | 'staff.read'
  | 'monitor.read'
  | 'evaluation.create'
  | 'evaluation.update'
  | 'evaluation.delete'
  | 'evaluation.approve'
  | 'evaluation.return'
  | 'request.create'
  | 'request.decide'
  | 'term.configure'
  | 'round.manage'
  | 'round.finalize'
  | 'place.manage'
  | 'duty.manage'
  | 'student.sync'
  | 'content.manage'
  | 'apikey.manage'
  | 'user.create'
  | 'user.setRole'
  | 'user.manage';

export interface PolicyContext {
  /** The user holds a matching committee duty for the target (BR-P1). */
  hasDuty?: boolean;
  /** The target is one of the user's own targets (teacher read scope). */
  ownTarget?: boolean;
}

const STAFF: readonly Role[] = ['super_admin', 'admin', 'executive'];
const ADMINS: readonly Role[] = ['super_admin', 'admin'];

export function can(user: SessionUser | null, action: Action, ctx: PolicyContext = {}): boolean {
  if (action === 'public.read') return true;
  if (!user) return false;
  const role = user.role;
  switch (action) {
    case 'staff.read':
    case 'monitor.read':
      return STAFF.includes(role) || ctx.ownTarget === true;
    case 'evaluation.create':
    case 'evaluation.update':
    case 'evaluation.delete':
    case 'request.create':
      return ctx.hasDuty === true;
    case 'evaluation.approve':
    case 'evaluation.return':
    case 'request.decide':
    case 'term.configure':
    case 'round.manage':
    case 'round.finalize':
    case 'place.manage':
    case 'duty.manage':
    case 'student.sync':
    case 'content.manage':
    case 'apikey.manage':
      return ADMINS.includes(role);
    case 'user.create':
    case 'user.setRole':
    case 'user.manage': // OPEN-QUESTION: Q8 answered — super admin only
      return role === 'super_admin';
  }
}

export function assertCan(user: SessionUser | null, action: Action, ctx?: PolicyContext): void {
  if (!can(user, action, ctx)) throw forbidden();
}

/** May open the admin area (executives read-only). */
export const isStaffRole = (role: Role) => STAFF.includes(role);
