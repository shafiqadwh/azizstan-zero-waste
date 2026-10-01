/**
 * Monitor board (08-ux-ui §6.17, 05-api "Monitor", T23b): every target of a round with its status, from "not
 * scored" to "PDF ready", the target popover and the activity feed. Scope is enforced here (06-auth
 * `monitor.read`): staff see everything (optionally only their own committee targets), a committee member without
 * a staff role sees only the targets assigned to them, anyone else gets FORBIDDEN.
 */
import type { Db } from '../../../db/client.ts';
import { bangkokDateString } from '../../lib/dates/index.ts';
import { parseScore, toDisplay } from '../../lib/scoring/decimal.ts';
import { componentsInUse, trimScore } from '../../lib/term/config.ts';
import { AppError, notFound } from '../errors.ts';
import { assertCan, can, isStaffRole, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as evalRepo from '../repositories/evaluations.repository.ts';
import * as monitorRepo from '../repositories/monitor.repository.ts';
import * as pdfRepo from '../repositories/pdf.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as requestsRepo from '../repositories/requests.repository.ts';
import * as roundsRepo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { REQUEST_LABEL } from './request.service.ts';
import { currentRound, describeTargets, targetRef, type TargetView } from './task.service.ts';

export type BoardStatus = 'not_evaluated' | 'submitted' | 'returned' | 'approved';
export const COUNTERS = [
  'not_evaluated',
  'submitted',
  'returned',
  'approved',
  'pdf_queued',
  'pdf_failed',
  'request',
] as const;
export type CounterKey = (typeof COUNTERS)[number];
export const COUNTER_LABEL: Record<CounterKey, string> = {
  not_evaluated: 'ยังไม่ประเมิน',
  submitted: 'รออนุมัติ',
  returned: 'ส่งกลับให้แก้',
  approved: 'อนุมัติแล้ว',
  pdf_queued: 'กำลังสร้าง PDF',
  pdf_failed: 'PDF ล้มเหลว',
  request: 'มีคำขอค้าง',
};

export const MONITOR_MSG = {
  noRound: 'ยังไม่มีรอบการประเมินในภาคเรียนนี้',
  notFailed: 'สร้าง PDF ใหม่ได้เฉพาะรายการที่สร้างไม่สำเร็จ',
} as const;

export interface CommitteeMember {
  userId: string;
  name: string;
  /** freelance assignments: "ชั่วคราว ถึง {date}" */
  until: Date | null;
}

export interface BoardRow {
  key: string;
  target: TargetView;
  /** rank group of a class ("ม.1"), null for areas — the room map's sections */
  group: string | null;
  /** the class's building/zone in this round, or the area itself */
  areaId: string | null;
  componentId: string;
  componentLabel: string;
  committee: CommitteeMember[];
  status: BoardStatus;
  /** not evaluated after `closes_at` */
  late: boolean;
  evaluationId: string | null;
  ownerName: string | null;
  submittedAt: Date | null;
  score: string | null;
  pdfStatus: 'none' | 'queued' | 'ready' | 'failed';
  pdfError: string | null;
  pdfUrl: string | null;
  waitingRequest: string | null;
  href: string | null;
}

export interface BoardFilters {
  status?: CounterKey;
  group?: string;
  area?: string;
  committee?: string;
  q?: string;
  mine?: boolean;
}

export interface Board {
  rounds: { id: string; roundNo: number; status: string }[];
  round: { id: string; roundNo: number; status: string; closesAt: Date } | null;
  areaWord: 'อาคาร' | 'โซน';
  /** rows in scope after every filter */
  rows: BoardRow[];
  /** per counter: rows in scope after the non-status filters — tapping one shows exactly that many rows */
  counters: Record<CounterKey, number>;
  options: { groups: string[]; areas: { id: string; name: string }[]; committee: { id: string; name: string }[] };
  canAct: boolean;
  /** staff who also hold a committee duty get "เฉพาะที่ฉันรับผิดชอบ" */
  canToggleMine: boolean;
  mine: boolean;
}

interface Scope {
  termId: string;
  all: boolean;
  /** target refs the actor may see when `all` is false */
  own: Set<string>;
  hasDuty: boolean;
}

const show = (s: string | null) => (s === null ? null : trimScore(toDisplay(parseScore(s))));

async function scopeOf(db: Db, actor: SessionUser, termId: string, now: Date, mine = false): Promise<Scope> {
  const duties = await evalRepo.listMyCommitteeDuties(db, termId, actor.id, now);
  const own = new Set(
    duties.map((d) =>
      targetRef(d.targetClassId ? { type: 'class', id: d.targetClassId } : { type: 'area', id: d.targetAreaId! }),
    ),
  );
  const hasDuty = own.size > 0;
  assertCan(actor, 'monitor.read', { hasDuty });
  const staff = isStaffRole(actor.role);
  return { termId, all: staff && !(mine && hasDuty), own, hasDuty };
}

const inScope = (scope: Scope, ref: string) => scope.all || scope.own.has(ref);

export function matchesCounter(row: BoardRow, key: CounterKey): boolean {
  switch (key) {
    case 'pdf_queued':
      return row.status === 'approved' && row.pdfStatus === 'queued';
    case 'pdf_failed':
      return row.pdfStatus === 'failed';
    case 'request':
      return row.waitingRequest !== null;
    default:
      return row.status === key;
  }
}

/** Every filter except status; the counters are computed on this set. */
export function filterRows(rows: BoardRow[], f: BoardFilters): BoardRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.group || r.group === f.group) &&
      (!f.area || r.areaId === f.area) &&
      (!f.committee || r.committee.some((c) => c.userId === f.committee)) &&
      (!q || (r.target.roomNumber ?? '').toLowerCase().includes(q) || r.target.label.toLowerCase().includes(q)),
  );
}

export function countRows(rows: BoardRow[]): Record<CounterKey, number> {
  return Object.fromEntries(COUNTERS.map((k) => [k, rows.filter((r) => matchesCounter(r, k)).length])) as Record<
    CounterKey,
    number
  >;
}

async function buildRows(db: Db, scope: Scope, round: termsRepo.RoundRow, now: Date): Promise<BoardRow[]> {
  const term = (await places.findTerm(db, scope.termId))!;
  const components = componentsInUse(await termsRepo.listComponents(db, term.id)).filter(
    (c) => c.source === 'committee',
  );
  const [classes, areas, selected, frozen, links, rooms] = await Promise.all([
    places.listClasses(db),
    places.listAreas(db),
    places.listTermClassIds(db, term.id),
    roundsRepo.listRoundClassAreas(db, round.id),
    places.listLinksOnDate(db, bangkokDateString(now)),
    places.listRooms(db),
  ]);
  const selectedSet = new Set(selected);
  const termAreas = areas.filter((a) => a.type === term.areaType && a.isActive);
  const frozenByClass = new Map(frozen.map((f) => [f.classId, f.areaId]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const linkByClass = new Map(links.map((l) => [l.classId, l]));
  const classAreaId = (classId: string) =>
    frozenByClass.get(classId) ??
    (term.areaType === 'building'
      ? (roomById.get(linkByClass.get(classId)?.physicalRoomId ?? '')?.buildingId ?? null)
      : null);

  const targets = [
    ...classes
      .filter((c) => selectedSet.has(c.id))
      .map((c) => ({
        type: 'class' as const,
        id: c.id,
        group: c.rankGroup as string | null,
        areaId: classAreaId(c.id),
      })),
    ...termAreas.map((a) => ({ type: 'area' as const, id: a.id, group: null, areaId: a.id as string | null })),
  ].filter((t) => inScope(scope, targetRef(t)));
  const views = await describeTargets(db, round.status === 'scheduled' ? null : round.id, targets, now);

  const live = await evalRepo.listLiveEvaluations(db, round.id);
  const pdfs = new Map((await pdfRepo.listCurrentPdfsInRound(db, round.id)).map((p) => [p.evaluationId, p.id]));
  const names = new Map((await usersRepo.listUsers(db)).map((u) => [u.id, u.displayName]));
  const committee = (await dutiesRepo.listTermDuties(db, term.id)).filter(
    (d) => d.duty === 'committee' && (d.validUntil === null || d.validUntil > now),
  );
  const waiting = await requestsRepo.listRequests(db, { statuses: ['waiting'], roundId: round.id });
  const closed = now >= round.closesAt || round.status === 'closed' || round.status === 'finalized';

  const rows: BoardRow[] = [];
  for (const t of targets) {
    for (const c of components.filter((x) => x.unit === t.type)) {
      const isTarget = (x: { targetClassId: string | null; targetAreaId: string | null }) =>
        t.type === 'class' ? x.targetClassId === t.id : x.targetAreaId === t.id;
      const found = live.find((l) => l.evaluation.componentId === c.id && isTarget(l.evaluation));
      const e = found?.evaluation;
      const request = waiting.find(
        (w) =>
          isTarget(w.request) &&
          (w.request.componentId === null || w.request.componentId === c.id) &&
          (w.request.evaluationId === null || w.request.evaluationId === e?.id),
      );
      const status: BoardStatus = e ? (e.status as BoardStatus) : 'not_evaluated';
      const pdfId = e ? pdfs.get(e.id) : undefined;
      rows.push({
        key: `${c.id}:${targetRef(t)}`,
        target: views.get(targetRef(t))!,
        group: t.group,
        areaId: t.areaId,
        componentId: c.id,
        componentLabel: c.label,
        committee: committee
          .filter((d) => isTarget(d))
          .map((d) => ({
            userId: d.userId,
            name: names.get(d.userId) ?? '–',
            until: d.isFreelance ? d.validUntil : null,
          })),
        status,
        late: closed && status === 'not_evaluated',
        evaluationId: e?.id ?? null,
        ownerName: found?.ownerName ?? null,
        submittedAt: e?.firstSubmittedAt ?? null,
        score: e ? show(e.score) : null,
        pdfStatus: (e?.pdfStatus ?? 'none') as BoardRow['pdfStatus'],
        pdfError: e?.pdfStatus === 'failed' ? e.pdfError : null,
        pdfUrl: pdfId && e?.pdfStatus === 'ready' ? `/api/v1/pdf/${pdfId}` : null,
        waitingRequest: request ? REQUEST_LABEL[request.request.type] : null,
        href: e ? `/evaluate/${e.id}` : null,
      });
    }
  }
  const byRoom = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'th', { numeric: true });
  return rows.sort(
    (a, b) =>
      Number(a.group === null) - Number(b.group === null) ||
      (a.group ?? '').localeCompare(b.group ?? '', 'th', { numeric: true }) ||
      byRoom(a.target.roomNumber, b.target.roomNumber) ||
      a.target.label.localeCompare(b.target.label, 'th'),
  );
}

async function resolveRound(db: Db, termId: string, roundId: string | undefined, now: Date) {
  const rounds = await termsRepo.listRounds(db, termId);
  const round = (roundId ? rounds.find((r) => r.id === roundId) : null) ?? currentRound(rounds, now);
  return { rounds, round };
}

/** GET /monitor/board — rows for `/monitor` (and the Excel export). */
export async function getBoard(
  db: Db,
  actor: SessionUser,
  opts: { roundId?: string; filters?: BoardFilters },
  now: Date,
): Promise<Board> {
  const f = opts.filters ?? {};
  const term = await places.findActiveTerm(db);
  if (!term) {
    assertCan(actor, 'monitor.read', { hasDuty: false });
    return {
      rounds: [],
      round: null,
      areaWord: 'อาคาร',
      rows: [],
      counters: countRows([]),
      options: { groups: [], areas: [], committee: [] },
      canAct: false,
      canToggleMine: false,
      mine: false,
    };
  }
  const scope = await scopeOf(db, actor, term.id, now, f.mine);
  const { rounds, round } = await resolveRound(db, term.id, opts.roundId, now);
  const all = round ? await buildRows(db, scope, round, now) : [];
  const filtered = filterRows(all, f);
  const areaNames = new Map((await places.listAreas(db)).map((a) => [a.id, a.name]));
  const committee = new Map(all.flatMap((r) => r.committee.map((c) => [c.userId, c.name] as const)));
  return {
    rounds: rounds.map((r) => ({ id: r.id, roundNo: r.roundNo, status: r.status })),
    round: round ? { id: round.id, roundNo: round.roundNo, status: round.status, closesAt: round.closesAt } : null,
    areaWord: term.areaType === 'zone' ? 'โซน' : 'อาคาร',
    rows: f.status ? filtered.filter((r) => matchesCounter(r, f.status!)) : filtered,
    counters: countRows(filtered),
    options: {
      groups: [...new Set(all.map((r) => r.group).filter((g): g is string => g !== null))],
      areas: [...new Set(all.map((r) => r.areaId).filter((a): a is string => a !== null))]
        .map((id) => ({ id, name: areaNames.get(id) ?? '–' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true })),
      committee: [...committee].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'th')),
    },
    canAct: can(actor, 'round.manage'),
    canToggleMine: isStaffRole(actor.role) && scope.hasDuty,
    mine: isStaffRole(actor.role) && scope.hasDuty && f.mine === true,
  };
}

// ───────────── popover (GET /monitor/targets/{type}/{id}) ─────────────

export interface TargetDetail {
  target: TargetView;
  committee: CommitteeMember[];
  items: {
    componentLabel: string;
    status: BoardStatus;
    late: boolean;
    ownerName: string | null;
    submittedAt: Date | null;
    approverName: string | null;
    approvedAt: Date | null;
    returnedReason: string | null;
    pdfUrl: string | null;
    href: string | null;
  }[];
  requests: { label: string; requesterName: string }[];
}

export async function getTargetDetail(
  db: Db,
  actor: SessionUser,
  input: { type: 'class' | 'area'; id: string; roundId?: string },
  now: Date,
): Promise<TargetDetail> {
  const term = await places.findActiveTerm(db);
  if (!term) throw notFound();
  const scope = await scopeOf(db, actor, term.id, now);
  if (!inScope(scope, targetRef(input))) throw new AppError('FORBIDDEN');
  const { round } = await resolveRound(db, term.id, input.roundId, now);
  if (!round) throw notFound();
  const rows = (await buildRows(db, { ...scope, all: true }, round, now)).filter(
    (r) => r.target.type === input.type && r.target.id === input.id,
  );
  if (rows.length === 0) throw notFound();
  const names = new Map((await usersRepo.listUsers(db)).map((u) => [u.id, u.displayName]));
  const items = [];
  for (const r of rows) {
    const e = r.evaluationId ? await evalRepo.findEvaluation(db, r.evaluationId) : null;
    items.push({
      componentLabel: r.componentLabel,
      status: r.status,
      late: r.late,
      ownerName: r.ownerName,
      submittedAt: r.submittedAt,
      approverName: e?.approvedBy ? (names.get(e.approvedBy) ?? null) : null,
      approvedAt: e?.status === 'approved' ? e.approvedAt : null,
      returnedReason: e?.status === 'returned' ? e.returnedReason : null,
      pdfUrl: r.pdfUrl,
      href: r.href,
    });
  }
  const waiting = await requestsRepo.listRequests(db, { statuses: ['waiting'], roundId: round.id });
  return {
    target: rows[0]!.target,
    committee: rows[0]!.committee,
    items,
    requests: waiting
      .filter((w) => (input.type === 'class' ? w.request.targetClassId : w.request.targetAreaId) === input.id)
      .map((w) => ({ label: REQUEST_LABEL[w.request.type], requesterName: w.requesterName })),
  };
}

// ───────────── activity feed (GET /monitor/activity, 11-jobs §2b) ─────────────

export interface ActivityItem {
  id: number;
  at: Date;
  text: string;
  href: string | null;
}

const VERB: Record<string, string> = {
  'evaluation.submit': 'ใส่คะแนน',
  'evaluation.update': 'แก้ไขผลประเมิน',
  'evaluation.resubmit': 'แก้ไขและส่งผลประเมินใหม่',
  'evaluation.delete': 'ลบผลประเมิน',
  'evaluation.approve': 'อนุมัติผลประเมิน',
  'evaluation.return': 'ส่งกลับผลประเมิน',
  'request.create': 'ส่งคำขอ',
  'request.approve': 'อนุมัติคำขอ',
  'request.reject': 'ปฏิเสธคำขอ',
};

export async function getActivity(
  db: Db,
  actor: SessionUser,
  input: { roundId?: string; since?: Date },
  now: Date,
): Promise<ActivityItem[]> {
  const term = await places.findActiveTerm(db);
  if (!term) {
    assertCan(actor, 'monitor.read', { hasDuty: false });
    return [];
  }
  const scope = await scopeOf(db, actor, term.id, now);
  const { round } = await resolveRound(db, term.id, input.roundId, now);
  if (!round) return [];
  const rows = await monitorRepo.listRoundActivity(db, round.id, { since: input.since, limit: 50 });
  const evals = new Map(
    (
      await monitorRepo.findEvaluationsByIds(
        db,
        rows.filter((r) => r.entity === 'evaluation').map((r) => r.entityId),
      )
    ).map((e) => [e.id, e]),
  );
  const reqs = new Map(
    (
      await monitorRepo.findRequestsByIds(
        db,
        rows.filter((r) => r.entity === 'request').map((r) => r.entityId),
      )
    ).map((r) => [r.id, r]),
  );
  const [classes, areas] = await Promise.all([places.listClasses(db), places.listAreas(db)]);
  const label = (t: { targetClassId: string | null; targetAreaId: string | null; roomNumberAtEval?: string | null }) =>
    t.targetClassId
      ? `${t.roomNumberAtEval ? `${t.roomNumberAtEval} · ` : ''}${classes.find((c) => c.id === t.targetClassId)?.displayName ?? '–'}`
      : (areas.find((a) => a.id === t.targetAreaId)?.name ?? '–');
  const ref = (t: { targetClassId: string | null; targetAreaId: string | null }) =>
    targetRef(t.targetClassId ? { type: 'class', id: t.targetClassId } : { type: 'area', id: t.targetAreaId! });

  const items: ActivityItem[] = [];
  for (const r of rows) {
    const after = (r.after ?? {}) as Record<string, unknown>;
    if (r.entity === 'evaluation') {
      const e = evals.get(r.entityId);
      if (!e || !inScope(scope, ref(e))) continue;
      const score = typeof after.score === 'string' && r.action !== 'evaluation.delete' ? ` ได้ ${after.score}` : '';
      items.push({
        id: r.id,
        at: r.at,
        text: `${r.actorName ?? 'ระบบ'} ${VERB[r.action]} ${label(e)}${score}`,
        href: e.status === 'void' ? null : `/evaluate/${e.id}`,
      });
    } else {
      const q = reqs.get(r.entityId);
      if (!q || !inScope(scope, ref(q))) continue;
      const e = q.evaluationId ? await evalRepo.findEvaluation(db, q.evaluationId) : null;
      items.push({
        id: r.id,
        at: r.at,
        text: `${r.actorName ?? 'ระบบ'} ${VERB[r.action]}${REQUEST_LABEL[q.type]} ${label({ ...q, roomNumberAtEval: e?.roomNumberAtEval })}`,
        href: e && e.status !== 'void' ? `/evaluate/${e.id}` : null,
      });
    }
  }
  return items;
}

// ───────────── "สร้างใหม่" for a failed PDF ─────────────

/** Puts a failed PDF back in the queue; the worker sweep renders it again (T22). */
export async function retryPdf(db: Db, actor: SessionUser, evaluationId: string, meta: ClientMeta, now: Date) {
  assertCan(actor, 'round.manage');
  await withTransaction(db, async (tx) => {
    const e = await evalRepo.lockEvaluation(tx, evaluationId);
    if (!e) throw notFound();
    if (e.status !== 'approved' || e.pdfStatus !== 'failed')
      throw new AppError('VALIDATION', { message: MONITOR_MSG.notFailed });
    await evalRepo.updateEvaluation(tx, e.id, { pdfStatus: 'queued', pdfError: null });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'pdf.retry',
        entity: 'evaluation',
        entityId: e.id,
        before: { pdfStatus: 'failed', pdfError: e.pdfError },
        after: { pdfStatus: 'queued' },
        ip: meta.ip,
      },
      now,
    );
  });
}

/** `/monitor?round=&status=&group=&area=&committee=&q=&mine=1` (also the API and the export) → board options. */
export function parseBoardQuery(p: URLSearchParams | Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    const v = p instanceof URLSearchParams ? p.get(k) : p[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.length <= 100 ? s : undefined;
  };
  const status = get('status');
  return {
    roundId: get('round'),
    filters: {
      status: COUNTERS.includes(status as CounterKey) ? (status as CounterKey) : undefined,
      group: get('group'),
      area: get('area'),
      committee: get('committee'),
      q: get('q'),
      mine: get('mine') === '1',
    } satisfies BoardFilters,
  };
}
