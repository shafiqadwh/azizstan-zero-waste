/**
 * Jobs `round.remind` and `round.overdue` (11-jobs §1–2, T26), run from the worker's minute sweep:
 * - 72 h and 24 h before `closes_at`: committee members with open targets get `round_reminder`
 *   ("อีก {h} ชั่วโมงปิดรับคะแนน · คุณยังเหลือ {n} รายการ"), admins and executives `round_reminder_staff`;
 * - 1 h after `closes_at`, then daily at 08:00 Bangkok while targets are missing: `overdue` to the committee of
 *   those targets and to admins.
 * Each reminder is sent once: a marker in `app_settings` records it (idempotent if the sweep runs twice).
 * "Open" = not evaluated or returned; evaluations waiting for approval are not nagged.
 */
import type { Db } from '../../../db/client.ts';
import { bangkokDateString, bangkokParts } from '../../lib/dates/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as systemRepo from '../repositories/system.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import { missingRows, type MissingRow } from './dashboard.service.ts';
import { send } from './notify.service.ts';

const HOUR = 3600_000;
const BEFORE = [72, 24] as const;

type Kind = 'remind72' | 'remind24' | 'overdue';

async function pending(db: Db, termId: string, round: termsRepo.RoundRow, now: Date) {
  const { rows } = await missingRows(db, termId, round, now);
  const open = rows.filter((r) => r.status !== 'submitted');
  const committee = (await dutiesRepo.listTermDuties(db, termId)).filter(
    (d) => d.duty === 'committee' && (d.validUntil === null || d.validUntil > now),
  );
  const perUser = new Map<string, MissingRow[]>();
  for (const r of open)
    for (const d of committee)
      if ((r.target.type === 'class' ? d.targetClassId : d.targetAreaId) === r.target.id)
        perUser.set(d.userId, [...(perUser.get(d.userId) ?? []), r]);
  return { open, perUser };
}

const label = (r: MissingRow) => (r.target.roomNumber ? `${r.target.roomNumber} · ${r.target.label}` : r.target.label);

async function notify(db: Db, round: termsRepo.RoundRow, termId: string, kind: Kind, now: Date) {
  const { open, perUser } = await pending(db, termId, round, now);
  if (open.length === 0) return 0;
  await withTransaction(db, async (tx) => {
    if (kind === 'overdue') {
      for (const [userId, rows] of perUser) {
        await send(
          tx,
          {
            userIds: [userId],
            type: 'overdue',
            title: 'เลยกำหนดใส่คะแนน',
            body:
              rows.length === 1
                ? `${label(rows[0]!)} ยังไม่มีคะแนน`
                : `${label(rows[0]!)} และอีก ${rows.length - 1} รายการยังไม่มีคะแนน`,
            link: '/tasks',
          },
          now,
        );
      }
      await send(
        tx,
        {
          userIds: await usersRepo.listActiveUserIdsByRole(tx, ['super_admin', 'admin']),
          type: 'overdue',
          title: 'เลยกำหนดใส่คะแนน',
          body: `รอบที่ ${round.roundNo} ยังไม่มีคะแนน ${open.length} รายการ`,
          link: '/admin',
        },
        now,
      );
    } else {
      const h = kind === 'remind72' ? 72 : 24;
      for (const [userId, rows] of perUser) {
        await send(
          tx,
          {
            userIds: [userId],
            type: 'round_reminder',
            title: `อีก ${h} ชั่วโมงปิดรับคะแนน`,
            body: `คุณยังเหลือ ${rows.length} รายการ`,
            link: '/tasks',
          },
          now,
        );
      }
      await send(
        tx,
        {
          userIds: await usersRepo.listActiveUserIdsByRole(tx, ['super_admin', 'admin', 'executive']),
          type: 'round_reminder_staff',
          title: `อีก ${h} ชั่วโมงปิดรับคะแนน`,
          body: `ยังไม่มีคะแนน ${open.length} รายการ`,
          link: '/admin',
        },
        now,
      );
    }
    await writeAudit(
      tx,
      {
        actorId: null,
        action: kind === 'overdue' ? 'round.overdue' : 'round.remind',
        entity: 'round',
        entityId: round.id,
        after: { kind, open: open.length, users: perUser.size },
      },
      now,
    );
  });
  return perUser.size;
}

/** Once per marker key; returns true when this call claimed it. */
async function claim(db: Db, key: string, now: Date): Promise<boolean> {
  if ((await systemRepo.readSetting(db, key)) !== null) return false;
  await systemRepo.writeSetting(db, key, { at: now.toISOString() }, now);
  return true;
}

export async function sweepReminders(db: Db, now: Date): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  const term = await places.findActiveTerm(db);
  if (!term) return { sent };
  for (const round of await termsRepo.listRounds(db, term.id)) {
    const closes = round.closesAt.getTime();
    if (round.status === 'open' && now.getTime() < closes) {
      // only the closest due threshold fires; a larger one that is also due is consumed silently
      const due = BEFORE.filter((h) => now.getTime() >= closes - h * HOUR);
      for (const h of due) {
        const key = `reminder:${round.id}:${h}`;
        if (!(await claim(db, key, now))) continue;
        if (h === Math.min(...due)) {
          await notify(db, round, term.id, h === 72 ? 'remind72' : 'remind24', now);
          sent.push(key);
        }
      }
    }
    if ((round.status === 'open' || round.status === 'closed') && now.getTime() >= closes + HOUR) {
      const today = bangkokDateString(now);
      const first = `overdue:${round.id}:first`;
      const daily = `overdue:${round.id}:${today}`;
      const isNewDay = today > bangkokDateString(round.closesAt) && bangkokParts(now).hour >= 8;
      if ((await systemRepo.readSetting(db, first)) === null) {
        await claim(db, first, now);
        await systemRepo.writeSetting(db, daily, { at: now.toISOString() }, now); // today is covered
        await notify(db, round, term.id, 'overdue', now);
        sent.push(first);
      } else if (isNewDay && (await claim(db, daily, now))) {
        await notify(db, round, term.id, 'overdue', now);
        sent.push(daily);
      }
    }
  }
  return { sent };
}
