/**
 * The permission matrix of docs/06-auth-permissions.md §3, as data. Keep this file readable side by side with
 * the doc: one row per action, one column per role. Changing a permission = changing a cell here (and the doc).
 *
 * Cell values
 *   'yes'      always allowed
 *   'no'       never allowed
 *   'duty'     allowed with a matching committee duty for the target (BR-P1)          → ctx.hasDuty
 *   'own'      allowed for the user's own targets only                               → ctx.ownTarget
 *   'approver' allowed unless the target has an approver duty held by someone else (BR-E6, Q10)
 *                                                                                    → ctx.approverAssigned / ctx.isApprover
 */
export const ROLES = ['super_admin', 'admin', 'executive', 'teacher'] as const;
export type Role = (typeof ROLES)[number];
export type Actor = Role | 'anonymous';

export type Rule = 'yes' | 'no' | 'duty' | 'own' | 'approver';

export const ACTIONS = [
  'public.read',
  'staff.read',
  'monitor.read',
  'evaluation.create',
  'evaluation.update',
  'evaluation.delete',
  'evaluation.approve',
  'evaluation.return',
  'request.create',
  'request.decide',
  'term.configure',
  'round.manage',
  'round.finalize',
  'place.manage',
  'duty.manage',
  'student.sync',
  'content.manage',
  'apikey.manage',
  'user.create',
  'user.setRole',
  'user.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

type Row = Record<Actor, Rule>;
const row = (super_admin: Rule, admin: Rule, executive: Rule, teacher: Rule, anonymous: Rule = 'no'): Row => ({
  super_admin,
  admin,
  executive,
  teacher,
  anonymous,
});

// prettier-ignore
export const PERMISSIONS: Record<Action, Row> = {
  //                     super_admin  admin       executive  teacher  anonymous
  'public.read':        row('yes',   'yes',      'yes',     'yes',   'yes'),
  'staff.read':         row('yes',   'yes',      'yes',     'own'),
  'monitor.read':       row('yes',   'yes',      'yes',     'duty'),   // teacher: own targets, needs committee duty
  'evaluation.create':  row('duty',  'duty',     'duty',    'duty'),
  'evaluation.update':  row('duty',  'duty',     'duty',    'duty'),
  'evaluation.delete':  row('duty',  'duty',     'duty',    'duty'),
  'evaluation.approve': row('yes',   'approver', 'no',      'no'),
  'evaluation.return':  row('yes',   'approver', 'no',      'no'),
  'request.create':     row('duty',  'duty',     'duty',    'duty'),
  'request.decide':     row('yes',   'yes',      'no',      'no'),
  'term.configure':     row('yes',   'yes',      'no',      'no'),
  'round.manage':       row('yes',   'yes',      'no',      'no'),
  'round.finalize':     row('yes',   'yes',      'no',      'no'),
  'place.manage':       row('yes',   'yes',      'no',      'no'),
  'duty.manage':        row('yes',   'yes',      'no',      'no'),
  'student.sync':       row('yes',   'yes',      'no',      'no'),
  'content.manage':     row('yes',   'yes',      'no',      'no'),
  'apikey.manage':      row('yes',   'yes',      'no',      'no'),
  'user.create':        row('yes',   'no',       'no',      'no'),
  'user.setRole':       row('yes',   'no',       'no',      'no'),
  'user.manage':        row('yes',   'no',       'no',      'no'),     // Q8: super admin only
};
