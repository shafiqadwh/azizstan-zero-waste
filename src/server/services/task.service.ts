/**
 * Committee read models (05-api "Committee", 08-ux-ui §6.7–6.9): my task list for the current round, the context
 * of the evaluation form, an evaluation's detail and the door-QR lookup. Writes go through evaluation.service.
 */
import type { Db } from '../../../db/client.ts';
import { bangkokDateString } from '../../lib/dates/index.ts';
import { parseScore, toDb, type Th } from '../../lib/scoring/decimal.ts';
import { individualClassValue } from '../../lib/scoring/index.ts';
import { componentsInUse, scoreStepFor } from '../../lib/term/config.ts';
import { AppError, notFound } from '../errors.ts';
import { assertCan, can, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as repo from '../repositories/evaluations.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as requestsRepo from '../repositories/requests.repository.ts';
import * as roundsRepo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { evidenceUrl } from './evidence.service.ts';
import { currentPdfId } from './pdf.service.ts';
import { listEvaluationRequests, type RequestCard } from './request.service.ts';

export type TaskStatus = 'not_evaluated' | 'submitted' | 'returned' | 'approved';

export interface TargetView {
  type: 'class' | 'area';
  id: string;
  /** "121 · ม.1 Amanah" or "อาคาร 1" — always rendered through TargetBadge */
  roomNumber: string | null;
  label: string;
  /** "อาคาร 1 ชั้น 2" for a class, "3 ห้องรับผิดชอบ" for an area */
  subtitle: string | null;
}

export interface TaskItem {
  key: string;
  roundId: string;
  componentId: string;
  componentLabel: string;
  target: TargetView;
  status: TaskStatus;
  evaluationId: string | null;
  ownerName: string | null;
  mine: boolean;
  href: string;
  /** T41 deduction (FR-E12): done only when the area teacher finds a problem, never "missing" */
  optional: boolean;
}

export interface RoundView {
  id: string;
  roundNo: number;
  status: 'scheduled' | 'open' | 'closed' | 'finalized';
  opensAt: Date;
  closesAt: Date;
  /** BR-T2 */
  entryOpen: boolean;
}

export interface MyTasks {
  termLabel: { termNo: number; academicYear: number } | null;
  round: RoundView | null;
  items: TaskItem[];
}

export const targetRef = (t: { type: 'class' | 'area'; id: string }) => `${t.type}:${t.id}`;

export function newEvaluationHref(roundId: string, componentId: string, t: { type: 'class' | 'area'; id: string }) {
  return `/evaluate/new?round=${roundId}&component=${componentId}&target=${targetRef(t)}`;
}

const entryOpen = (r: { status: string; opensAt: Date; closesAt: Date }, now: Date) =>
  r.status === 'open' && r.opensAt <= now && now < r.closesAt;

/** The round committees work on: the open one, else the latest that has opened, else the next scheduled. */
export function currentRound<R extends { status: string; opensAt: Date; roundNo: number }>(
  rounds: R[],
  now: Date,
): R | null {
  return (
    rounds.find((r) => r.status === 'open') ??
    [...rounds].reverse().find((r) => r.status !== 'scheduled' && r.opensAt <= now) ??
    rounds.find((r) => r.status === 'scheduled') ??
    null
  );
}

export async function describeTargets(
  db: Db,
  roundId: string | null,
  targets: { type: 'class' | 'area'; id: string }[],
  now: Date,
) {
  const [classes, areas, rooms, frozen, links] = await Promise.all([
    places.listClasses(db),
    places.listAreas(db),
    places.listRooms(db),
    roundId ? roundsRepo.listRoundClassAreas(db, roundId) : Promise.resolve([]),
    places.listLinksOnDate(db, bangkokDateString(now)),
  ]);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const frozenByClass = new Map(frozen.map((f) => [f.classId, f]));
  const linkByClass = new Map(links.map((l) => [l.classId, l]));
  const map = new Map<string, TargetView>();
  for (const t of targets) {
    if (t.type === 'class') {
      const c = classes.find((x) => x.id === t.id);
      const f = frozenByClass.get(t.id);
      const room = roomById.get(f?.physicalRoomId ?? linkByClass.get(t.id)?.physicalRoomId ?? '');
      const building = areaById.get(f?.areaId ?? room?.buildingId ?? '');
      map.set(targetRef(t), {
        ...t,
        roomNumber: room?.roomNumber ?? null,
        label: c?.displayName ?? '–',
        subtitle: building ? `${building.name}${room?.floor != null ? ` ชั้น ${room.floor}` : ''}` : null,
      });
    } else {
      const responsible = frozen.filter((f) => f.areaId === t.id).length;
      map.set(targetRef(t), {
        ...t,
        roomNumber: null,
        label: areaById.get(t.id)?.name ?? '–',
        subtitle: responsible > 0 ? `${responsible} ห้องรับผิดชอบ` : null,
      });
    }
  }
  return map;
}

const STATUS_ORDER: Record<TaskStatus, number> = { returned: 0, not_evaluated: 1, submitted: 2, approved: 3 };

/** Room numbers in numeric order; targets without one (areas) after them. */
const byRoom = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'th', { numeric: true });

/** 08-ux-ui §6.7: returned first, then not evaluated by room number, then the rest. */
export function sortTasks(items: TaskItem[]): TaskItem[] {
  return [...items].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      byRoom(a.target.roomNumber, b.target.roomNumber) ||
      a.target.label.localeCompare(b.target.label, 'th'),
  );
}

export async function getMyTasks(db: Db, actor: SessionUser, now: Date): Promise<MyTasks> {
  const term = await places.findActiveTerm(db);
  if (!term) return { termLabel: null, round: null, items: [] };
  const termLabel = { termNo: term.termNo, academicYear: term.academicYear };
  const rounds = await termsRepo.listRounds(db, term.id);
  const round = currentRound(rounds, now);
  const duties = await repo.listMyCommitteeDuties(db, term.id, actor.id, now);
  if (!round) return { termLabel, round: null, items: [] };
  const selected = new Set(await places.listTermClassIds(db, term.id));
  const targets = [
    ...new Map(
      duties
        .filter((d) => (d.targetClassId ? selected.has(d.targetClassId) : d.targetAreaId !== null))
        .map((d) => {
          const t = d.targetClassId
            ? { type: 'class' as const, id: d.targetClassId }
            : { type: 'area' as const, id: d.targetAreaId! };
          return [targetRef(t), t] as const;
        }),
    ).values(),
  ];
  const allComponents = componentsInUse(await termsRepo.listComponents(db, term.id));
  const components = allComponents.filter((c) => c.source === 'committee');
  // T41: an area teacher's targets are their areas and the classes frozen into them for this round
  const teacherComponents = allComponents.filter((c) => c.source === 'area_teacher');
  const teacherTargets: { type: 'class' | 'area'; id: string }[] = [];
  if (teacherComponents.length > 0 && round.status !== 'scheduled') {
    const areaIds = new Set(
      (await dutiesRepo.listMyAreaTeacherDuties(db, term.id, actor.id, now)).map((d) => d.targetAreaId!),
    );
    if (areaIds.size > 0) {
      for (const a of areaIds) teacherTargets.push({ type: 'area', id: a });
      for (const r of await roundsRepo.listRoundClassAreas(db, round.id))
        if (areaIds.has(r.areaId) && selected.has(r.classId)) teacherTargets.push({ type: 'class', id: r.classId });
    }
  }
  const views = await describeTargets(
    db,
    round.status === 'scheduled' ? null : round.id,
    [...targets, ...teacherTargets],
    now,
  );
  const live = await repo.listLiveEvaluations(db, round.id);
  const items: TaskItem[] = [];
  const work: [{ type: 'class' | 'area'; id: string }[], typeof components][] = [
    [targets, components],
    [teacherTargets, teacherComponents],
  ];
  for (const [list, comps] of work)
    for (const t of list) {
      for (const c of comps.filter((x) => x.unit === t.type)) {
        const found = live.find(
          (l) =>
            l.evaluation.componentId === c.id &&
            (t.type === 'class' ? l.evaluation.targetClassId === t.id : l.evaluation.targetAreaId === t.id),
        );
        items.push({
          key: `${c.id}:${targetRef(t)}`,
          roundId: round.id,
          componentId: c.id,
          componentLabel: c.label,
          target: views.get(targetRef(t))!,
          status: found ? (found.evaluation.status as TaskStatus) : 'not_evaluated',
          evaluationId: found?.evaluation.id ?? null,
          ownerName: found?.ownerName ?? null,
          mine: found ? found.evaluation.ownerId === actor.id : false,
          href: found ? `/evaluate/${found.evaluation.id}` : newEvaluationHref(round.id, c.id, t),
          optional: c.kind === 'deduct',
        });
      }
    }
  return {
    termLabel,
    round: { ...round, entryOpen: entryOpen(round, now) },
    items: sortTasks(items),
  };
}

// ───────────── form context (§6.8) ─────────────

export interface EvaluationForm {
  round: RoundView;
  componentId: string;
  componentLabel: string;
  target: TargetView;
  max: Th;
  step: Th;
  scoreFormat: 'integer' | 'decimal';
  photoMin: number;
  photoMax: number;
  requiresSignature: boolean;
  commentMax: number;
  selfEditHours: number;
  individual: boolean;
  /** T41 (FR-E12): an area teacher's deduction — the score is the points taken off, the comment is the reason */
  deduction: boolean;
  /** "อนุมัติอัตโนมัติ" is on: submitting approves at once (no admin step) */
  autoApprove: boolean;
  /** Individual mode (T40): the class's snapshot students for the round, codes only (FR-S1); [] otherwise. */
  students: { id: string; code: string }[];
  /** Entry is open for this user: the round is open, or they hold a late-entry grant (BR-P2). */
  canEnter: boolean;
  /** Someone already scored it (BR-P3): the form is replaced by the detail. */
  existingId: string | null;
  /** Entry closed: a late-entry request may be sent (BR-P2), unless one is already waiting. */
  canRequestLate: boolean;
  lateRequestWaiting: boolean;
  lateEntryDefaultHours: number;
}

export async function getEvaluationForm(
  db: Db,
  actor: SessionUser,
  q: { roundId: string; componentId: string; target: { type: 'class' | 'area'; id: string } },
  now: Date,
): Promise<EvaluationForm> {
  const round = await termsRepo.findRound(db, q.roundId);
  if (!round) throw notFound();
  const term = (await places.findTerm(db, round.termId))!;
  const component = (await termsRepo.listComponents(db, term.id)).find((c) => c.id === q.componentId);
  if (!component || !component.enabled || component.unit !== q.target.type) throw notFound();
  const hasDuty = await dutiesRepo.hasScoringDutyFor(
    db,
    {
      termId: term.id,
      userId: actor.id,
      source: component.source,
      target: q.target.type === 'class' ? { classId: q.target.id } : { areaId: q.target.id },
      roundId: round.id,
    },
    now,
  );
  assertCan(actor, 'evaluation.create', { hasDuty });
  const override = (await termsRepo.listRoundMax(db, [round.id])).find((m) => m.componentId === component.id);
  const view = (await describeTargets(db, round.status === 'scheduled' ? null : round.id, [q.target], now)).get(
    targetRef(q.target),
  )!;
  const live = await repo.findLiveEvaluation(db, round.id, component.id, q.target);
  const open = entryOpen(round, now);
  const individual = component.unit === 'class' && component.kind === 'score' && term.roomMode === 'individual';
  const deduction = component.kind === 'deduct';
  const granted =
    !open &&
    round.status !== 'scheduled' &&
    round.status !== 'finalized' &&
    (await repo.hasLateEntryGrant(
      db,
      { userId: actor.id, roundId: round.id, componentId: component.id, target: q.target },
      now,
    ));
  return {
    round: { ...round, entryOpen: open },
    componentId: component.id,
    componentLabel: component.label,
    target: view,
    max: parseScore(override?.maxValue ?? component.maxValue),
    step: scoreStepFor(term),
    scoreFormat: term.scoreFormat,
    photoMin: deduction ? 1 : term.photoMin,
    photoMax: term.photoMax,
    requiresSignature: deduction ? false : component.requiresSignature,
    deduction,
    autoApprove: term.autoApprove,
    commentMax: term.commentMax,
    selfEditHours: term.selfEditHours,
    individual,
    students: individual && round.status !== 'scheduled' ? await repo.listRosterCodes(db, round.id, q.target.id) : [],
    canEnter: open || granted,
    existingId: live?.evaluation.id ?? null,
    canRequestLate: !open && !granted && (round.status === 'open' || round.status === 'closed'),
    lateRequestWaiting: !!(await requestsRepo.findWaitingLateEntry(db, {
      requesterId: actor.id,
      roundId: round.id,
      componentId: component.id,
      targetClassId: q.target.type === 'class' ? q.target.id : null,
      targetAreaId: q.target.type === 'area' ? q.target.id : null,
    })),
    lateEntryDefaultHours: term.lateEntryDefaultHours,
  };
}

// ───────────── detail (§6.9) ─────────────

export interface PhotoView {
  id: string;
  kind: 'site' | 'signature';
  thumb: string;
  full: string;
}

export interface EvaluationDetail {
  id: string;
  roundId: string;
  roundNo: number;
  componentId: string;
  componentLabel: string;
  /** T41: an area teacher's deduction (score = points taken off, comment = reason) */
  deduction: boolean;
  /** approved on submit by "อนุมัติอัตโนมัติ" (no admin) */
  autoApproved: boolean;
  target: TargetView;
  status: Exclude<TaskStatus, 'not_evaluated'> | 'void';
  /** the score; in individual mode the class mean of the student scores (BR-S2) */
  score: string | null;
  max: Th;
  /** Individual mode (T40): each snapshot student's score by code (no names, FR-S1); [] in group mode. */
  studentScores: { studentId: string; code: string; score: Th }[];
  comment: string | null;
  ownerName: string;
  isOwner: boolean;
  /** Owner may still edit or delete it (BR-E2). */
  canEdit: boolean;
  selfEditUntil: Date;
  returnedReason: string | null;
  version: number;
  step: Th;
  scoreFormat: 'integer' | 'decimal';
  photoMax: number;
  /** "ขออนุมัติแก้ไข" is offered (owner after the window or once approved; any committee member of the target). */
  canRequest: boolean;
  /** move_target choices for the owner: their other targets of the same unit with no live evaluation */
  moveOptions: { type: 'class' | 'area'; id: string; label: string }[];
  requests: RequestCard[];
  /** current PDF version (approved evaluations, 09-pdf) */
  pdfUrl: string | null;
  pdfStatus: string;
  photos: PhotoView[];
  history: { action: string; at: Date; actorName: string | null }[];
}

export async function getEvaluationDetail(
  db: Db,
  actor: SessionUser,
  id: string,
  now: Date,
): Promise<EvaluationDetail> {
  const e = await repo.findEvaluation(db, id);
  if (!e) throw notFound();
  const round = (await termsRepo.findRound(db, e.roundId))!;
  const t =
    e.targetType === 'class'
      ? { type: 'class' as const, id: e.targetClassId! }
      : { type: 'area' as const, id: e.targetAreaId! };
  const isOwner = e.ownerId === actor.id;
  const ownTarget =
    isOwner ||
    (await dutiesRepo.hasDutyForComponent(
      db,
      {
        termId: round.termId,
        userId: actor.id,
        componentId: e.componentId,
        target: t.type === 'class' ? { classId: t.id } : { areaId: t.id },
        roundId: round.id,
      },
      now,
    ));
  if (!can(actor, 'staff.read', { ownTarget })) throw new AppError('FORBIDDEN');
  const component = (await termsRepo.listComponents(db, round.termId)).find((c) => c.id === e.componentId)!;
  const term = (await places.findTerm(db, round.termId))!;
  // "อนุมัติอัตโนมัติ": an evaluation nobody approved stays the owner's to fix inside the window, until finalize
  const autoApproved = e.status === 'approved' && e.approvedBy === null;
  const canEdit =
    isOwner &&
    (e.status === 'submitted' || e.status === 'returned' || (autoApproved && round.status !== 'finalized')) &&
    now < e.selfEditUntil;
  const roundOpenForRequests = round.status !== 'finalized' || actor.role === 'super_admin';
  const canRequest = ownTarget && e.status !== 'void' && !canEdit && roundOpenForRequests;
  let moveOptions: EvaluationDetail['moveOptions'] = [];
  if (isOwner && canRequest) {
    const mine = await repo.listMyCommitteeDuties(db, round.termId, actor.id, now);
    const live = await repo.listLiveEvaluations(db, round.id);
    const taken = new Set(
      live
        .filter((l) => l.evaluation.componentId === e.componentId)
        .map((l) => l.evaluation.targetClassId ?? l.evaluation.targetAreaId),
    );
    const selected = new Set(await places.listTermClassIds(db, round.termId));
    const options = mine
      .map((d) =>
        d.targetClassId
          ? { type: 'class' as const, id: d.targetClassId }
          : { type: 'area' as const, id: d.targetAreaId! },
      )
      .filter((o) => o.type === component.unit && !taken.has(o.id) && (o.type === 'area' || selected.has(o.id)));
    const views = await describeTargets(db, round.id, options, now);
    moveOptions = options.map((o) => {
      const v = views.get(targetRef(o))!;
      return { ...o, label: v.roomNumber ? `${v.roomNumber} · ${v.label}` : v.label };
    });
  }
  const override = (await termsRepo.listRoundMax(db, [round.id])).find((m) => m.componentId === component.id);
  const [view, photos, history, owner, studentRows] = await Promise.all([
    describeTargets(db, round.id, [t], now),
    repo.listEvaluationEvidence(db, e.id),
    repo.listEvaluationHistory(db, e.id),
    usersRepo.findUserById(db, e.ownerId),
    repo.listStudentScoresWithCodes(db, e.id),
  ]);
  const studentScores = studentRows.map((r) => ({ ...r, score: parseScore(r.score) }));
  const classMean = e.score === null ? individualClassValue(studentScores.map((r) => r.score)) : null;
  return {
    id: e.id,
    roundId: round.id,
    roundNo: round.roundNo,
    componentId: component.id,
    componentLabel: component.label,
    deduction: component.kind === 'deduct',
    autoApproved,
    target: { ...view.get(targetRef(t))!, roomNumber: e.roomNumberAtEval ?? view.get(targetRef(t))!.roomNumber },
    status: e.status,
    score: e.score ?? (classMean === null ? null : toDb(classMean)),
    max: parseScore(override?.maxValue ?? component.maxValue),
    studentScores,
    comment: e.comment,
    ownerName: owner?.displayName ?? '–',
    isOwner,
    canEdit,
    canRequest,
    moveOptions,
    requests: await listEvaluationRequests(db, e.id),
    pdfUrl: await currentPdfId(db, e.id).then((id) => (id ? `/api/v1/pdf/${id}` : null)),
    pdfStatus: e.pdfStatus,
    step: scoreStepFor(term),
    scoreFormat: term.scoreFormat,
    photoMax: term.photoMax,
    selfEditUntil: e.selfEditUntil,
    returnedReason: e.status === 'returned' ? e.returnedReason : null,
    version: e.version,
    photos: photos.map((p) => ({ id: p.id, kind: p.kind, thumb: evidenceUrl(p.id, 320), full: evidenceUrl(p.id) })),
    history,
  };
}

// ───────────── door QR (/r/[qrToken]) ─────────────

/**
 * The page a door QR leads to: the class in that room today, in the user's current round — the form when it is
 * not evaluated yet, else the detail. Null when the user has no task for that room.
 */
export async function hrefForRoomQr(db: Db, actor: SessionUser, qrToken: string, now: Date): Promise<string | null> {
  const room = await places.findRoomByQrToken(db, qrToken);
  if (!room) return null;
  const link = await places.linkOfRoomOnDate(db, room.id, bangkokDateString(now));
  if (!link) return null;
  const tasks = await getMyTasks(db, actor, now);
  return tasks.items.find((i) => i.target.type === 'class' && i.target.id === link.classId)?.href ?? null;
}
