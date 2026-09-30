/**
 * T11: every role × action cell of the 06-auth §3 matrix. The expected table below is transcribed from the doc
 * independently of ./matrix.ts, so a wrong cell in either place fails a test.
 */
import { describe, expect, test } from 'vitest';
import { AppError } from '../errors.ts';
import { assertCan, can, type PolicyContext, type SessionUser } from './index.ts';
import { ACTIONS, ROLES, type Action, type Actor, type Role } from './matrix.ts';

type Expect = '✓' | '–' | 'duty' | 'own' | 'approver';
// prettier-ignore
const DOC: Record<Action, [Expect, Expect, Expect, Expect, Expect]> = {
  //                     super_admin admin     executive teacher anonymous
  'public.read':        ['✓',        '✓',      '✓',      '✓',    '✓'],
  'staff.read':         ['✓',        '✓',      '✓',      'own',  '–'],
  'monitor.read':       ['✓',        '✓',      '✓',      'duty', '–'],
  'evaluation.create':  ['duty',     'duty',   'duty',   'duty', '–'],
  'evaluation.update':  ['duty',     'duty',   'duty',   'duty', '–'],
  'evaluation.delete':  ['duty',     'duty',   'duty',   'duty', '–'],
  'evaluation.approve': ['✓',        'approver','–',     '–',    '–'],
  'evaluation.return':  ['✓',        'approver','–',     '–',    '–'],
  'request.create':     ['duty',     'duty',   'duty',   'duty', '–'],
  'request.decide':     ['✓',        '✓',      '–',      '–',    '–'],
  'term.configure':     ['✓',        '✓',      '–',      '–',    '–'],
  'round.manage':       ['✓',        '✓',      '–',      '–',    '–'],
  'round.finalize':     ['✓',        '✓',      '–',      '–',    '–'],
  'place.manage':       ['✓',        '✓',      '–',      '–',    '–'],
  'duty.manage':        ['✓',        '✓',      '–',      '–',    '–'],
  'student.sync':       ['✓',        '✓',      '–',      '–',    '–'],
  'content.manage':     ['✓',        '✓',      '–',      '–',    '–'],
  'apikey.manage':      ['✓',        '✓',      '–',      '–',    '–'],
  'user.create':        ['✓',        '–',      '–',      '–',    '–'],
  'user.setRole':       ['✓',        '–',      '–',      '–',    '–'],
  'user.manage':        ['✓',        '–',      '–',      '–',    '–'],
};
const ACTORS: Actor[] = [...ROLES, 'anonymous'];

const userFor = (actor: Actor): SessionUser | null =>
  actor === 'anonymous'
    ? null
    : {
        id: 'u1',
        username: actor,
        displayName: actor,
        role: actor as Role,
        authSource: 'local',
        mustChangePassword: false,
        sessionId: 's1',
      };

/** Contexts that distinguish every rule kind. */
const CTX: Record<string, PolicyContext> = {
  none: {},
  duty: { hasDuty: true },
  own: { ownTarget: true },
  approverElsewhere: { approverAssigned: true, isApprover: false },
  approverSelf: { approverAssigned: true, isApprover: true },
};

function expected(cell: Expect, ctx: PolicyContext): boolean {
  switch (cell) {
    case '✓':
      return true;
    case '–':
      return false;
    case 'duty':
      return ctx.hasDuty === true;
    case 'own':
      return ctx.ownTarget === true;
    case 'approver':
      return !(ctx.approverAssigned === true && ctx.isApprover !== true);
  }
}

test('the doc table and the matrix list the same actions', () => {
  expect(Object.keys(DOC).sort()).toEqual([...ACTIONS].sort());
});

const cells = ACTIONS.flatMap((action) => ACTORS.map((actor, i) => ({ action, actor, cell: DOC[action][i]! })));

describe.each(cells)('$action × $actor ($cell)', ({ action, actor, cell }) => {
  test.each(Object.entries(CTX))('ctx %s', (_name, ctx) => {
    expect(can(userFor(actor), action, ctx)).toBe(expected(cell, ctx));
  });
});

describe('specific rules', () => {
  test('BR-E6: an admin who is not the assigned approver cannot approve; super admin always can', () => {
    const admin = userFor('admin');
    expect(can(admin, 'evaluation.approve')).toBe(true); // no approver assigned (Q10)
    expect(can(admin, 'evaluation.approve', CTX.approverElsewhere)).toBe(false);
    expect(can(admin, 'evaluation.approve', CTX.approverSelf)).toBe(true);
    expect(can(userFor('super_admin'), 'evaluation.approve', CTX.approverElsewhere)).toBe(true);
  });

  test('roles are never narrowed by duty: admin without duty still configures, executive is read-only', () => {
    expect(can(userFor('admin'), 'term.configure')).toBe(true);
    expect(can(userFor('executive'), 'staff.read')).toBe(true);
    expect(can(userFor('executive'), 'term.configure')).toBe(false);
  });

  test('assertCan throws FORBIDDEN with the Thai message', () => {
    expect(() => assertCan(userFor('admin'), 'user.create')).toThrow(AppError);
    expect(() => assertCan(null, 'staff.read')).toThrow('คุณไม่มีสิทธิ์ทำรายการนี้');
    expect(() => assertCan(userFor('super_admin'), 'user.create')).not.toThrow();
  });
});
