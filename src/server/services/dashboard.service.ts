/**
 * Admin dashboard and approvals read models (08-ux-ui §6.10–6.11, T23): KPIs of the current round, the targets
 * still without an approved score, the evaluations waiting for approval, and the "แจ้งเตือนกรรมการที่ค้าง" nudge.
 * Decisions go through evaluation.service (approve / return) and result.service (finalize).
 */
import type { Db } from '../../../db/client.ts';
import { parseScore, toDisplay, type Th } from '../../lib/scoring/decimal.ts';
import { componentsInUse, trimScore } from '../../lib/term/config.ts';
import { assertCan, can, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as evalRepo from '../repositories/evaluations.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as requestsRepo from '../repositories/requests.repository.ts';
import * as systemRepo from '../repositories/system.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { evidenceUrl } from './evidence.service.ts';
import { send } from './notify.service.ts';
import { computeRoundResults, RESULT_MSG } from './result.service.ts';
import { currentRound, describeTargets, targetRef, type TargetView } from './task.service.ts';

export const DASHBOARD_MSG = {
  incomplete: (n: number) => `ปุ่มปิดรอบจะกดได้เมื่อทุกห้องและทุกอาคารมีคะแนนครบ (เหลือ ${n} รายการ)`,
  noRound: 'ยังไม่มีรอบที่เปิดลงคะแนน',
  nobodyToRemind: 'ไม่มีกรรมการที่ค้างประเมิน',
  reminded: (n: number) => `ส่งการแจ้งเตือนถึงกรรมการ ${n} คนแล้ว`,
} as const;

const show = (th: Th) => trimScore(toDisplay(th));

export type MissingStatus = 'not_evaluated' | 'submitted' | 'returned';

export interface MissingRow {
  key: string;
  target: TargetView;
  componentLabel: string;
  /** committee members assigned to the target ("ยังไม่มีกรรมการ" when empty) */
  committee: string[];
  status: MissingStatus;
  evaluationId: string | null;
  /** past `closes_at` and still nothing waiting for approval */
  late: boolean;
}

export interface ResultCard {
  id: string;
  version: number;
  roundNo: number;
  target: { roomNumber: string | null; label: string };
  componentLabel: string;
  ownerName: string;
  submittedAt: Date;
  /** "4.5"; null in individual mode (per-student scores) */
  score: string | null;
  max: string;
  photos: { id: string; kind: 'site' | 'signature'; thumb: string }[];
  comment: string;
  /** BR-E6: false when another admin is this target's approver (or for executives) */
  canDecide: boolean;
}

export interface Dashboard {
  term: { id: string; termNo: number; academicYear: number; areaType: 'building' | 'zone' } | null;
  round: { id: string; roundNo: number; status: string; opensAt: Date; closesAt: Date } | null;
  kpi: {
    classesDone: number;
    classesTotal: number;
    areasDone: number;
    areasTotal: number;
    waitingResults: number;
    waitingRequests: number;
    overdue: number;
  };
  missing: MissingRow[];
  waiting: ResultCard[];
  /** null = "ปิดรอบ" can be pressed; otherwise the reason shown under the disabled button */
  finalizeBlocker: string | null;
  sync: { status: string | null; startedAt: Date; finishedAt: Date | null; error: string | null } | null;
  canAct: boolean;
}

const byRoom = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'th', { numeric: true });

/** §6.11 result cards: every evaluation waiting for approval in the active term, oldest first. */
export async function listWaitingResults(db: Db, actor: SessionUser, now: Date): Promise<ResultCard[]> {
  assertCan(actor, 'staff.read');
  const term = await places.findActiveTerm(db);
  if (!term) return [];
  const rows = await evalRepo.listSubmittedEvaluations(db, term.id);
  if (rows.length === 0) return [];
  const components = await termsRepo.listComponents(db, term.id);
  const overrides = await termsRepo.listRoundMax(db, [...new Set(rows.map((r) => r.evaluation.roundId))]);
  const [classes, areas] = await Promise.all([places.listClasses(db), places.listAreas(db)]);
  const cards: ResultCard[] = [];
  for (const { evaluation: e, ownerName, roundNo } of rows) {
    const component = components.find((c) => c.id === e.componentId)!;
    const max =
      overrides.find((m) => m.roundId === e.roundId && m.componentId === e.componentId)?.maxValue ?? component.maxValue;
    const photos = (await evalRepo.listEvaluationEvidence(db, e.id))
      .map((p) => ({ id: p.id, kind: p.kind, thumb: evidenceUrl(p.id, 320) }))
      .sort((a, b) => Number(a.kind === 'signature') - Number(b.kind === 'signature'));
    const approvers = await evalRepo.listApproverIds(
      db,
      term.id,
      e.targetType === 'class' ? { type: 'class', id: e.targetClassId! } : { type: 'area', id: e.targetAreaId! },
      now,
    );
    cards.push({
      id: e.id,
      version: e.version,
      roundNo,
      target:
        e.targetType === 'class'
          ? {
              roomNumber: e.roomNumberAtEval,
              label: classes.find((c) => c.id === e.targetClassId)?.displayName ?? '–',
            }
          : { roomNumber: null, label: areas.find((a) => a.id === e.targetAreaId)?.name ?? '–' },
      componentLabel: component.label,
      ownerName,
      submittedAt: e.lastEditedAt,
      score: e.score === null ? null : show(parseScore(e.score)),
      max: show(parseScore(max)),
      photos,
      comment: e.comment ?? '',
      canDecide: can(actor, 'evaluation.approve', {
        approverAssigned: approvers.length > 0,
        isApprover: approvers.includes(actor.id),
      }),
    });
  }
  return cards;
}

/** Targets of the round still without an approved score, late ones first, then by room number. */
async function missingRows(db: Db, termId: string, round: termsRepo.RoundRow, now: Date) {
  const results = await computeRoundResults(db, round.id);
  const components = componentsInUse(await termsRepo.listComponents(db, termId));
  const items = results.missing.filter((m) => m.componentId !== null);
  const targets = [
    ...new Map(items.map((m) => [`${m.targetType}:${m.targetId}`, { type: m.targetType, id: m.targetId }])).values(),
  ];
  const views = await describeTargets(db, round.status === 'scheduled' ? null : round.id, targets, now);
  const live = await evalRepo.listLiveEvaluations(db, round.id);
  const names = new Map((await usersRepo.listUsers(db)).map((u) => [u.id, u.displayName]));
  const committee = (await dutiesRepo.listTermDuties(db, termId)).filter(
    (d) => d.duty === 'committee' && (d.validUntil === null || d.validUntil > now),
  );
  const closed = now >= round.closesAt || round.status === 'closed';
  const rows: MissingRow[] = items.map((m) => {
    const found = live.find(
      (l) =>
        l.evaluation.componentId === m.componentId &&
        (m.targetType === 'class'
          ? l.evaluation.targetClassId === m.targetId
          : l.evaluation.targetAreaId === m.targetId),
    )?.evaluation;
    const status: MissingStatus = found ? (found.status === 'returned' ? 'returned' : 'submitted') : 'not_evaluated';
    return {
      key: `${m.componentId}:${m.targetType}:${m.targetId}`,
      target: views.get(targetRef({ type: m.targetType, id: m.targetId }))!,
      componentLabel: components.find((c) => c.id === m.componentId)?.label ?? '',
      committee: committee
        .filter((d) => (m.targetType === 'class' ? d.targetClassId : d.targetAreaId) === m.targetId)
        .map((d) => names.get(d.userId) ?? '–'),
      status,
      evaluationId: found?.id ?? null,
      late: closed && status !== 'submitted',
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.late) - Number(a.late) ||
      byRoom(a.target.roomNumber, b.target.roomNumber) ||
      a.target.label.localeCompare(b.target.label, 'th'),
  );
  return { results, rows };
}

/** §6.10 "ภาพรวม" for staff (executives get the same data; the page hides the actions). */
export async function getDashboard(db: Db, actor: SessionUser, now: Date): Promise<Dashboard> {
  assertCan(actor, 'staff.read');
  const syncRun = await systemRepo.findLatestSyncRun(db);
  const sync = syncRun
    ? { status: syncRun.status, startedAt: syncRun.startedAt, finishedAt: syncRun.finishedAt, error: syncRun.error }
    : null;
  const canAct = can(actor, 'round.manage');
  const waiting = await listWaitingResults(db, actor, now);
  const waitingList = await requestsRepo.listRequests(db, { statuses: ['waiting'] });
  const waitingRequests = waitingList.length;
  const empty = {
    classesDone: 0,
    classesTotal: 0,
    areasDone: 0,
    areasTotal: 0,
    waitingResults: waiting.length,
    waitingRequests,
    overdue: 0,
  };
  const term = await places.findActiveTerm(db);
  if (!term) return { term: null, round: null, kpi: empty, missing: [], waiting, finalizeBlocker: null, sync, canAct };
  const termView = { id: term.id, termNo: term.termNo, academicYear: term.academicYear, areaType: term.areaType };
  const round = currentRound(await termsRepo.listRounds(db, term.id), now);
  if (!round)
    return {
      term: termView,
      round: null,
      kpi: empty,
      missing: [],
      waiting,
      finalizeBlocker: DASHBOARD_MSG.noRound,
      sync,
      canAct,
    };

  const { results, rows } = await missingRows(db, term.id, round, now);
  const missingClass = new Set(results.missing.filter((m) => m.targetType === 'class').map((m) => m.targetId));
  const missingArea = new Set(results.missing.filter((m) => m.targetType === 'area').map((m) => m.targetId));
  const usedAreas = [...new Set(results.classes.map((c) => c.areaId).filter((a): a is string => a !== null))];
  const blockingInRound = waitingList.filter((r) => r.request.roundId === round.id && r.request.type !== 'late_entry');
  const finalizeBlocker =
    round.status === 'finalized'
      ? RESULT_MSG.alreadyFinal
      : round.status !== 'closed'
        ? RESULT_MSG.notClosed
        : results.missing.length > 0
          ? DASHBOARD_MSG.incomplete(results.missing.length)
          : blockingInRound.length > 0
            ? RESULT_MSG.waitingRequests(blockingInRound.length)
            : null;

  return {
    term: termView,
    round: {
      id: round.id,
      roundNo: round.roundNo,
      status: round.status,
      opensAt: round.opensAt,
      closesAt: round.closesAt,
    },
    kpi: {
      classesDone: results.classes.filter((c) => !missingClass.has(c.classId)).length,
      classesTotal: results.classes.length,
      areasDone: usedAreas.filter((a) => !missingArea.has(a)).length,
      areasTotal: usedAreas.length,
      waitingResults: waiting.length,
      waitingRequests,
      overdue: rows.filter((r) => r.late).length,
    },
    missing: rows,
    waiting,
    finalizeBlocker,
    sync,
    canAct,
  };
}

/**
 * "แจ้งเตือนกรรมการที่ค้าง": one notification per committee member who still has a target without an evaluation
 * (or one returned to them) in the current round — `round_reminder` before the close, `overdue` after it.
 */
export async function remindPendingCommittees(
  db: Db,
  actor: SessionUser,
  meta: ClientMeta,
  now: Date,
): Promise<{ users: number; message: string }> {
  assertCan(actor, 'round.manage');
  const term = await places.findActiveTerm(db);
  const round = term ? currentRound(await termsRepo.listRounds(db, term.id), now) : null;
  if (!term || !round || round.status === 'scheduled' || round.status === 'finalized')
    return { users: 0, message: DASHBOARD_MSG.noRound };
  const { rows } = await missingRows(db, term.id, round, now);
  const pending = rows.filter((r) => r.status !== 'submitted');
  const committee = (await dutiesRepo.listTermDuties(db, term.id)).filter(
    (d) => d.duty === 'committee' && (d.validUntil === null || d.validUntil > now),
  );
  const perUser = new Map<string, number>();
  for (const r of pending) {
    for (const d of committee) {
      const id = r.target.type === 'class' ? d.targetClassId : d.targetAreaId;
      if (id === r.target.id) perUser.set(d.userId, (perUser.get(d.userId) ?? 0) + 1);
    }
  }
  if (perUser.size === 0) return { users: 0, message: DASHBOARD_MSG.nobodyToRemind };
  const closed = now >= round.closesAt;
  const hours = Math.max(1, Math.ceil((round.closesAt.getTime() - now.getTime()) / 3_600_000));
  await withTransaction(db, async (tx) => {
    for (const [userId, n] of perUser) {
      await send(
        tx,
        {
          userIds: [userId],
          type: closed ? 'overdue' : 'round_reminder',
          title: closed ? 'เลยกำหนดใส่คะแนน' : `อีก ${hours} ชั่วโมงปิดรับคะแนน`,
          body: `คุณยังเหลือ ${n} รายการ`,
          link: '/tasks',
        },
        now,
      );
    }
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'round.remind',
        entity: 'round',
        entityId: round.id,
        after: { users: perUser.size, items: pending.length },
        ip: meta.ip,
      },
      now,
    );
  });
  return { users: perUser.size, message: DASHBOARD_MSG.reminded(perUser.size) };
}
