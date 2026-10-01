/**
 * Results engine (BR-S1..S6, BR-R3, T21). Live results are computed from approved evaluations only; finalize
 * freezes them (round_class_results / round_area_results / round_student_results with frozen = true).
 * All arithmetic goes through src/lib/scoring (integer thousandths).
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { parseScore, toDb, type Th } from '../../lib/scoring/decimal.ts';
import {
  competitionRank,
  individualClassValue,
  roundTotal,
  termScoreByRound,
  type AppliedComponent,
} from '../../lib/scoring/index.ts';
import { componentsInUse } from '../../lib/term/config.ts';
import { AppError, notFound, parseInput } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/results.repository.ts';
import * as roundsRepo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { withTransaction, type DbOrTx, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { send } from './notify.service.ts';

export const RESULT_MSG = {
  notClosed: 'ปิดรอบได้เมื่อรอบปิดรับคะแนนแล้ว',
  alreadyFinal: 'รอบนี้ปิดรอบแล้ว',
  waitingRequests: (n: number) => `ยังปิดรอบไม่ได้ มีคำขอรออนุมัติ ${n} รายการ`,
} as const;

export interface ClassResult {
  classId: string;
  rankGroup: string;
  areaId: string | null;
  classScore: Th;
  areaScore: Th;
  deduction: Th;
  /** null = some applicable component has no approved value yet ("รอผล") */
  total: Th | null;
  max: Th;
  rank: number | null;
}

export interface AreaResult {
  areaId: string;
  score: Th | null;
  max: Th;
  rank: number | null;
}

/** A (component, target) still without an approved evaluation, or a class without an area. */
export interface MissingItem {
  componentId: string | null;
  targetType: 'class' | 'area';
  targetId: string;
}

export interface RoundResults {
  roundId: string;
  frozen: boolean;
  classes: ClassResult[];
  areas: AreaResult[];
  students: { studentId: string; classId: string; total: Th }[];
  missing: MissingItem[];
}

/**
 * Live computation for one round (BR-S1..S3, BR-S5, BR-S6). Pure reads; callers inside a transaction pass `tx`
 * (reads run one after another on its single connection).
 */
export async function computeRoundResults(db: DbOrTx, roundId: string): Promise<RoundResults> {
  const round = await termsRepo.findRound(db, roundId);
  if (!round) throw notFound();
  const term = (await places.findTerm(db, round.termId))!;
  const components = componentsInUse(await termsRepo.listComponents(db, term.id));
  const overrides = new Map(
    (await termsRepo.listRoundMax(db, [round.id])).map((m) => [m.componentId, parseScore(m.maxValue)]),
  );
  const maxOf = (c: (typeof components)[number]) => overrides.get(c.id) ?? parseScore(c.maxValue);
  const classes = await places.listClasses(db);
  const selected = new Set(await places.listTermClassIds(db, term.id));
  const areas = (await places.listAreas(db)).filter((a) => a.type === term.areaType && a.isActive);
  const classArea = new Map((await roundsRepo.listRoundClassAreas(db, round.id)).map((r) => [r.classId, r.areaId]));
  const approved = await repo.listApprovedEvaluations(db, round.id);
  const studentScores = await repo.listStudentScoresOf(
    db,
    approved.map((e) => e.id),
  );

  /** value of a component for a target: individual mode → mean of student scores (BR-S2) */
  const valueOf = (componentId: string, type: 'class' | 'area', id: string): Th | null => {
    const e = approved.find(
      (x) => x.componentId === componentId && (type === 'class' ? x.targetClassId === id : x.targetAreaId === id),
    );
    if (!e) return null;
    if (e.score !== null) return parseScore(e.score);
    return individualClassValue(studentScores.filter((s) => s.evaluationId === e.id).map((s) => parseScore(s.score)));
  };

  const missing: MissingItem[] = [];
  const usedAreas = new Set<string>();
  const classResults: Omit<ClassResult, 'rank'>[] = [];
  for (const c of classes.filter((x) => selected.has(x.id))) {
    const areaId = classArea.get(c.id) ?? null;
    if (areaId) usedAreas.add(areaId);
    else if (round.status !== 'scheduled') missing.push({ componentId: null, targetType: 'class', targetId: c.id });
    const applied: AppliedComponent[] = [];
    let max = 0;
    for (const comp of components) {
      if (comp.unit === 'area' && !areaId) continue; // BR-S1
      const value = comp.unit === 'class' ? valueOf(comp.id, 'class', c.id) : valueOf(comp.id, 'area', areaId!);
      if (comp.unit === 'class' && value === null && comp.kind === 'score')
        missing.push({ componentId: comp.id, targetType: 'class', targetId: c.id });
      applied.push({
        kind: comp.kind,
        unit: comp.unit,
        max: maxOf(comp),
        // a deduction nobody entered counts as 0; a score nobody entered leaves the total open
        value: value ?? (comp.kind === 'deduct' ? 0 : null),
      });
      if (comp.kind === 'score') max += maxOf(comp);
    }
    const t = roundTotal(applied);
    classResults.push({
      classId: c.id,
      rankGroup: c.rankGroup,
      areaId,
      classScore: t?.classScore ?? 0,
      areaScore: t?.areaScore ?? 0,
      deduction: t?.deduction ?? 0,
      total: t?.total ?? null,
      max,
    });
  }

  const areaComps = components.filter((c) => c.unit === 'area');
  const areaResults: Omit<AreaResult, 'rank'>[] = areas.map((a) => {
    let score: Th | null = 0;
    let deduct = 0;
    let max = 0;
    for (const comp of areaComps) {
      const v = valueOf(comp.id, 'area', a.id);
      if (comp.kind === 'deduct') deduct += Math.min(v ?? 0, maxOf(comp));
      else {
        max += maxOf(comp);
        if (v === null) {
          score = null;
          if (usedAreas.has(a.id)) missing.push({ componentId: comp.id, targetType: 'area', targetId: a.id });
        } else if (score !== null) score += v;
      }
    }
    return { areaId: a.id, score: score === null ? null : Math.max(0, score - deduct), max };
  });

  // BR-S5: competition ranking per rank group; areas in one list
  const ranked: ClassResult[] = [];
  for (const group of [...new Set(classResults.map((c) => c.rankGroup))]) {
    const members = classResults.filter((c) => c.rankGroup === group);
    for (const r of competitionRank(members.map((m) => ({ ...m, id: m.classId, score: m.total })))) {
      const { id: _id, score: _score, ...rest } = r;
      ranked.push(rest);
    }
  }
  const rankedAreas = competitionRank(areaResults.map((a) => ({ ...a, id: a.areaId }))).map(
    ({ id: _id, ...rest }) => rest,
  );

  // BR-S6: each snapshot student gets the total of the class they were in for this round
  const totalByClass = new Map(classResults.map((c) => [c.classId, c.total]));
  const students = (await repo.listRoster(db, round.id))
    .map((s) => ({ studentId: s.studentId, classId: s.classId, total: totalByClass.get(s.classId) ?? null }))
    .filter((s): s is { studentId: string; classId: string; total: Th } => s.total !== null);

  return { roundId: round.id, frozen: false, classes: ranked, areas: rankedAreas, students, missing };
}

/** Frozen rows when the round is finalized, else live (dashboards, public pages, T24). */
export async function getRoundResults(db: Db, roundId: string): Promise<RoundResults> {
  const live = await computeRoundResults(db, roundId);
  const round = (await termsRepo.findRound(db, roundId))!;
  if (round.status !== 'finalized') return live;
  const frozenClasses = await repo.listFrozenClassResults(db, roundId);
  const frozenAreas = await repo.listFrozenAreaResults(db, roundId);
  const byClass = new Map(frozenClasses.map((r) => [r.classId, r]));
  const byArea = new Map(frozenAreas.map((r) => [r.areaId, r]));
  return {
    ...live,
    frozen: true,
    classes: live.classes.map((c) => {
      const f = byClass.get(c.classId);
      return f
        ? {
            ...c,
            classScore: parseScore(f.classScore),
            areaScore: parseScore(f.areaScore),
            deduction: parseScore(f.deduction),
            total: parseScore(f.total),
            rank: f.rankInGroup,
          }
        : c;
    }),
    areas: live.areas.map((a) => {
      const f = byArea.get(a.areaId);
      return f ? { ...a, score: parseScore(f.score), rank: f.rank } : a;
    }),
  };
}

async function freeze(tx: Tx, results: RoundResults, now: Date) {
  await repo.replaceResults(tx, results.roundId, {
    classes: results.classes
      .filter((c) => c.total !== null)
      .map((c) => ({
        roundId: results.roundId,
        classId: c.classId,
        areaId: c.areaId,
        classScore: toDb(c.classScore),
        areaScore: toDb(c.areaScore),
        deduction: toDb(c.deduction),
        total: toDb(c.total!),
        rankInGroup: c.rank!,
        frozen: true,
        computedAt: now,
      })),
    areas: results.areas
      .filter((a) => a.score !== null)
      .map((a) => ({
        roundId: results.roundId,
        areaId: a.areaId,
        score: toDb(a.score!),
        rank: a.rank!,
        frozen: true,
        computedAt: now,
      })),
    students: results.students.map((s) => ({ roundId: results.roundId, ...s, total: toDb(s.total) })),
  });
}

export const finalizeInput = z.object({ roundId: z.uuid() });

/**
 * BR-R3 "ปิดรอบ": every selected class has an area and every applicable component an approved evaluation,
 * and no request is waiting. Writes the frozen results, marks the round finalized, queues the final PDFs
 * (no watermark — T22) and tells admins and executives.
 */
export async function finalizeRound(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof finalizeInput>,
  meta: ClientMeta,
  now: Date,
): Promise<RoundResults> {
  assertCan(actor, 'round.finalize');
  const { roundId } = parseInput(finalizeInput, raw);
  return withTransaction(db, async (tx) => {
    const round = await roundsRepo.lockRound(tx, roundId);
    if (!round) throw notFound();
    if (round.status === 'finalized') throw new AppError('VALIDATION', { message: RESULT_MSG.alreadyFinal });
    if (round.status !== 'closed') throw new AppError('VALIDATION', { message: RESULT_MSG.notClosed });
    const results = await computeRoundResults(tx, roundId);
    if (results.missing.length > 0) throw new AppError('ROUND_NOT_COMPLETE', { params: { n: results.missing.length } });
    const waiting = await repo.countBlockingRequests(tx, roundId);
    if (waiting > 0) throw new AppError('VALIDATION', { message: RESULT_MSG.waitingRequests(waiting) });

    await freeze(tx, results, now);
    await termsRepo.updateRound(tx, roundId, { status: 'finalized', finalizedAt: now, finalizedBy: actor.id });
    await repo.queueRoundPdfs(tx, roundId);
    const expired = await repo.expireWaitingRequests(tx, roundId, now);
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'round.finalize',
        entity: 'round',
        entityId: roundId,
        before: { status: 'closed' },
        after: {
          status: 'finalized',
          classes: results.classes.length,
          areas: results.areas.length,
          students: results.students.length,
          expiredRequests: expired,
        },
        ip: meta.ip,
      },
      now,
    );
    const staff = await usersRepo.listActiveUserIdsByRole(tx, ['super_admin', 'admin', 'executive']);
    await send(
      tx,
      {
        userIds: staff,
        type: 'round_finalized',
        title: `ปิดรอบที่ ${round.roundNo} แล้ว`,
        body: 'ผลคะแนนของรอบนี้เป็นผลสุดท้าย',
        link: '/admin',
      },
      now,
    );
    return { ...results, frozen: true };
  });
}

/**
 * BR-Q5: an approved request on a finalized round (super admin only) recomputes and refreezes that round in
 * the same transaction. Unlike finalize, missing data does not block — the round was complete when frozen.
 */
export async function refreezeRound(tx: Tx, roundId: string, now: Date): Promise<void> {
  await freeze(tx, await computeRoundResults(tx, roundId), now);
  await repo.queueRoundPdfs(tx, roundId);
}

// ───────────── term results (BR-S4, BR-S4b) ─────────────

export interface TermClassResult {
  classId: string;
  rankGroup: string;
  /** per round in round order: total or null */
  rounds: (Th | null)[];
  termScore: Th | null;
  rank: number | null;
}

/** Equal round weights via termScoreByRound, scaled to the term maximum; ranked per rank group. */
export async function getTermResults(db: Db, termId: string): Promise<{ classes: TermClassResult[]; finalMax: Th }> {
  const term = await places.findTerm(db, termId);
  if (!term) throw notFound();
  const rounds = (await termsRepo.listRounds(db, termId)).filter((r) => r.status !== 'scheduled');
  const perRound: RoundResults[] = [];
  for (const r of rounds) perRound.push(await getRoundResults(db, r.id));
  const finalMax = parseScore(term.finalMax);
  const classIds = [...new Set(perRound.flatMap((r) => r.classes.map((c) => c.classId)))];
  const rows = classIds.map((classId) => {
    const per = perRound.map((r) => r.classes.find((c) => c.classId === classId) ?? null);
    const termScore = termScoreByRound(
      per.filter((p): p is ClassResult => p !== null && p.max > 0).map((p) => ({ total: p.total, max: p.max })),
      finalMax,
    );
    return {
      classId,
      rankGroup: per.find((p) => p)?.rankGroup ?? '',
      rounds: per.map((p) => p?.total ?? null),
      termScore,
    };
  });
  const classes: TermClassResult[] = [];
  for (const group of [...new Set(rows.map((r) => r.rankGroup))]) {
    for (const r of competitionRank(
      rows.filter((x) => x.rankGroup === group).map((x) => ({ ...x, id: x.classId, score: x.termScore })),
    )) {
      const { id: _id, score: _score, ...rest } = r;
      classes.push(rest);
    }
  }
  return { classes, finalMax };
}
