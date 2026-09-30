/**
 * Authorization (06-auth §2–3): decision = role + duty. The matrix lives in ./matrix.ts as data; this module
 * evaluates a cell. Duty, ownership and approver facts arrive through `ctx`, resolved by the calling service
 * (06-auth §4 rule 2).
 */
import { forbidden } from '../errors.ts';
import { PERMISSIONS, type Action, type Actor, type Role, type Rule } from './matrix.ts';

export type { Action, Role } from './matrix.ts';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  authSource: 'local' | 'school';
  mustChangePassword: boolean;
  sessionId: string;
}

export interface PolicyContext {
  /** The user holds a matching committee duty for the target (BR-P1). */
  hasDuty?: boolean;
  /** The target is one of the user's own targets. */
  ownTarget?: boolean;
  /** Someone holds the approver duty for this target (BR-E6). */
  approverAssigned?: boolean;
  /** The user is that approver. */
  isApprover?: boolean;
}

export function evaluateRule(rule: Rule, ctx: PolicyContext): boolean {
  switch (rule) {
    case 'yes':
      return true;
    case 'no':
      return false;
    case 'duty':
      return ctx.hasDuty === true;
    case 'own':
      return ctx.ownTarget === true;
    case 'approver':
      return ctx.approverAssigned !== true || ctx.isApprover === true;
  }
}

export function can(user: SessionUser | null, action: Action, ctx: PolicyContext = {}): boolean {
  const actor: Actor = user ? user.role : 'anonymous';
  return evaluateRule(PERMISSIONS[action][actor], ctx);
}

export function assertCan(user: SessionUser | null, action: Action, ctx?: PolicyContext): void {
  if (!can(user, action, ctx)) throw forbidden();
}

const STAFF: readonly Role[] = ['super_admin', 'admin', 'executive'];
/** May open the admin area (06-auth §4 rule 3; executives read-only). */
export const isStaffRole = (role: Role) => STAFF.includes(role);
