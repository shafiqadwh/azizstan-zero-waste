import { describe, expect, test } from 'vitest';
import { AppError } from '../errors.ts';
import { assertCan, can, type Action, type Role, type SessionUser } from './index.ts';

const user = (role: Role): SessionUser => ({
  id: 'u',
  username: role,
  displayName: role,
  role,
  authSource: 'local',
  mustChangePassword: false,
  sessionId: 's',
});

// Rows of the 06-auth §3 matrix that depend on the role alone: [action, super_admin, admin, executive, teacher]
const MATRIX: [Action, boolean, boolean, boolean, boolean][] = [
  ['staff.read', true, true, true, false],
  ['monitor.read', true, true, true, false],
  ['evaluation.approve', true, true, false, false],
  ['evaluation.return', true, true, false, false],
  ['request.decide', true, true, false, false],
  ['term.configure', true, true, false, false],
  ['round.manage', true, true, false, false],
  ['round.finalize', true, true, false, false],
  ['place.manage', true, true, false, false],
  ['duty.manage', true, true, false, false],
  ['student.sync', true, true, false, false],
  ['content.manage', true, true, false, false],
  ['apikey.manage', true, true, false, false],
  ['user.create', true, false, false, false],
  ['user.setRole', true, false, false, false],
  ['user.manage', true, false, false, false],
];

describe('permission matrix (06-auth §3)', () => {
  test.each(MATRIX)('%s', (action, sa, ad, ex, te) => {
    expect([
      can(user('super_admin'), action),
      can(user('admin'), action),
      can(user('executive'), action),
      can(user('teacher'), action),
    ]).toEqual([sa, ad, ex, te]);
    expect(can(null, action)).toBe(false);
  });

  test('public.read is open to everyone, including anonymous', () => {
    expect(can(null, 'public.read')).toBe(true);
  });

  test('evaluation and request actions need a duty for every role', () => {
    for (const role of ['super_admin', 'admin', 'executive', 'teacher'] as const) {
      expect(can(user(role), 'evaluation.create')).toBe(false);
      expect(can(user(role), 'evaluation.create', { hasDuty: true })).toBe(true);
      expect(can(user(role), 'request.create', { hasDuty: true })).toBe(true);
    }
  });

  test('a teacher reads only own targets', () => {
    expect(can(user('teacher'), 'staff.read', { ownTarget: true })).toBe(true);
  });

  test('assertCan throws FORBIDDEN', () => {
    expect(() => assertCan(user('admin'), 'user.create')).toThrow(AppError);
    expect(() => assertCan(user('admin'), 'user.create')).toThrow('คุณไม่มีสิทธิ์ทำรายการนี้');
  });
});
