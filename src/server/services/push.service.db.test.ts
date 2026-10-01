/** T26: push fan-out with batching, subscriptions, inbox, and the reminder / overdue sweeps. */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { notifications, pushSubscriptions, roundClassAreas, rounds } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { send } from './notify.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import {
  getInbox,
  markInboxRead,
  subscribePush,
  sweepPush,
  type PushPayload,
  type PushResult,
  type PushSender,
} from './push.service.ts';
import { sweepReminders } from './reminder.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_push_${randomBytes(4).toString('hex')}`;
const withDb = (name: string) => Object.assign(new URL(baseUrl), { pathname: `/${name}` }).toString();
const pgAdmin = async (sql: string) => {
  const c = new pg.Client({ connectionString: withDb('postgres') });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
};

const t0 = new Date('2026-11-18T03:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const meta = { ip: '10.0.0.27', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let admin: SessionUser;
let executive: SessionUser;
let teacher: SessionUser;
let lonely: SessionUser;

const sent: { endpoint: string; payload: PushPayload }[] = [];
let answer: PushResult = 'ok';
const sender: PushSender = async (sub, payload) => {
  sent.push({ endpoint: sub.endpoint, payload });
  return answer;
};
const notice = (userIds: string[], type: string, title: string, when: Date) =>
  send(db, { userIds, type, title, body: `${title} body`, link: '/monitor' }, when);
const ofType = async (userId: string, type: string) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, t0, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, t0);
  const su = await signIn('root', 'root-password');
  const mk = async (username: string, role: 'admin' | 'teacher' | 'executive') => {
    const u = await createUser(db, su, { username, displayName: username, role }, meta, t0);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'admin');
  executive = await mk('exe', 'executive');
  teacher = await mk('t.one', 'teacher');
  lonely = await mk('t.two', 'teacher');
  await subscribePush(
    db,
    admin,
    { endpoint: 'https://push.example/admin-1', keys: { p256dh: 'p256dh-key-admin', auth: 'auth-admin' } },
    'vitest',
    t0,
  );
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('push.send (11-jobs §2)', () => {
  test('three score notices in a burst → one batched push; a later one waits out the 10-minute window', async () => {
    for (const i of [1, 2, 3]) await notice([admin.id], 'evaluation_submitted', `ใส่คะแนน ${i}`, at(0));
    expect(await sweepPush(db, sender, at(0))).toEqual({ pushes: 1, waiting: 0 });
    expect(sent).toEqual([
      {
        endpoint: 'https://push.example/admin-1',
        payload: {
          title: 'มีการใส่/แก้ไขคะแนนใหม่',
          body: 'มีการใส่/แก้ไขคะแนนใหม่ 3 รายการ',
          link: '/monitor',
          tag: 'evaluation_submitted',
        },
      },
    ]);
    await notice([admin.id], 'evaluation_submitted', 'ใส่คะแนน 4', at(2));
    expect(await sweepPush(db, sender, at(2))).toEqual({ pushes: 0, waiting: 1 }); // inbox only for now
    expect(sent).toHaveLength(1);
    expect(await sweepPush(db, sender, at(11))).toEqual({ pushes: 1, waiting: 0 });
    expect(sent[1]!.payload).toMatchObject({ title: 'ใส่คะแนน 4', body: 'ใส่คะแนน 4 body' });
    // another type is its own window
    await notice([admin.id], 'request_created', 'มีคำขออนุมัติใหม่', at(12));
    expect(await sweepPush(db, sender, at(12))).toEqual({ pushes: 1, waiting: 0 });
  });

  test('no subscription or no VAPID keys: rows are handled (inbox only); stale rows are never pushed', async () => {
    await notice([lonely.id], 'duty_assigned', 'ได้รับมอบหมาย', at(20));
    await notice([admin.id], 'round_opened', 'เก่า', new Date(t0.getTime() - 2 * 86_400_000));
    const before = sent.length;
    await sweepPush(db, sender, at(20));
    expect(sent).toHaveLength(before);
    expect((await ofType(lonely.id, 'duty_assigned'))[0]!.pushedAt).toEqual(at(20));
    expect((await ofType(admin.id, 'round_opened'))[0]!.pushedAt).not.toBeNull();
    await notice([admin.id], 'sync_problem', 'Sync ล้มเหลว', at(21));
    await sweepPush(db, null, at(21));
    expect(sent).toHaveLength(before);
  });

  test('a subscription answering 404/410 is deleted', async () => {
    answer = 'gone';
    await notice([admin.id], 'round_complete', 'ครบแล้ว', at(30));
    await sweepPush(db, sender, at(30));
    expect(await db.select().from(pushSubscriptions)).toEqual([]);
    answer = 'ok';
  });

  test('subscriptions must be https; the inbox counts and clears unread', async () => {
    await expect(
      subscribePush(
        db,
        teacher,
        { endpoint: 'http://insecure.example/x', keys: { p256dh: 'p256dh-key-x', auth: 'auth-xxxx' } },
        null,
        t0,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const inbox = await getInbox(db, admin);
    expect(inbox.unread).toBe(inbox.items.length);
    expect(inbox.items[0]).toMatchObject({ type: 'round_complete', read: false });
    await markInboxRead(db, admin, at(40), [inbox.items[0]!.id]);
    expect((await getInbox(db, admin)).unread).toBe(inbox.unread - 1);
    await markInboxRead(db, admin, at(41));
    expect((await getInbox(db, admin)).unread).toBe(0);
  });
});

describe('round.remind / round.overdue', () => {
  const closesAt = new Date('2026-11-20T09:30:00Z'); // 16:30 Bangkok
  beforeAll(async () => {
    const b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, t0);
    const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121', floor: 2 }, meta, t0);
    const A = await upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
      meta,
      t0,
    );
    await linkClassRoom(db, admin, { classId: A, physicalRoomId: r121, effectiveFrom: '2026-11-01' }, meta, t0);
    const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, t0);
    await setTermClasses(db, admin, { termId, classIds: [A] }, meta, t0);
    await activateTerm(db, admin, { termId }, meta, t0);
    const roundId = newId();
    await db.insert(rounds).values({
      id: roundId,
      termId,
      roundNo: 1,
      opensAt: new Date('2026-11-16T01:00:00Z'),
      closesAt,
      status: 'open',
    });
    await db.insert(roundClassAreas).values({ roundId, classId: A, areaId: b1, physicalRoomId: r121 });
    await assignDuty(
      db,
      admin,
      { termId, userId: teacher.id, duty: 'committee', targetType: 'class', targetId: A },
      meta,
      t0,
    );
  });

  test('20 h before the close only the 24 h reminder fires, once', async () => {
    const now = new Date(closesAt.getTime() - 20 * 3600_000);
    expect((await sweepReminders(db, now)).sent).toHaveLength(1);
    expect((await ofType(teacher.id, 'round_reminder')).map((n) => [n.title, n.body, n.link])).toEqual([
      ['อีก 24 ชั่วโมงปิดรับคะแนน', 'คุณยังเหลือ 1 รายการ', '/tasks'],
    ]);
    expect((await ofType(executive.id, 'round_reminder_staff'))[0]).toMatchObject({
      title: 'อีก 24 ชั่วโมงปิดรับคะแนน',
      link: '/admin',
    });
    expect((await sweepReminders(db, new Date(now.getTime() + 60_000))).sent).toEqual([]);
    expect(await ofType(teacher.id, 'round_reminder')).toHaveLength(1);
  });

  test('1 h after the close: overdue to the committee and admins; then daily at 08:00 Bangkok', async () => {
    expect((await sweepReminders(db, new Date(closesAt.getTime() + 30 * 60_000))).sent).toEqual([]); // +30 min
    expect((await sweepReminders(db, new Date(closesAt.getTime() + 2 * 3600_000))).sent).toHaveLength(1);
    expect((await ofType(teacher.id, 'overdue')).map((n) => n.body)).toEqual(['121 · ม.1 Amanah ยังไม่มีคะแนน']);
    expect((await ofType(admin.id, 'overdue'))[0]!.body).toMatch(/^รอบที่ 1 ยังไม่มีคะแนน \d+ รายการ$/);
    expect((await sweepReminders(db, new Date('2026-11-21T00:00:00Z'))).sent).toEqual([]); // 07:00 next day
    expect((await sweepReminders(db, new Date('2026-11-21T01:05:00Z'))).sent).toHaveLength(1); // 08:05
    expect((await sweepReminders(db, new Date('2026-11-21T05:00:00Z'))).sent).toEqual([]);
    expect(await ofType(teacher.id, 'overdue')).toHaveLength(2);
  });
});
