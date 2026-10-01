/**
 * Terms, score components and rounds (FR-C*, BR-TM1..TM4, BR-R5, T14).
 * Config (terms row + components + round count + per-round maxima) is locked once the term has an evaluation (BR-TM2).
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import { parseScore, toDb } from '../../lib/scoring/decimal.ts';
import { checkRoundDateChange, componentsInUse, DECIMAL_STEPS } from '../../lib/term/config.ts';
import { AppError, notFound, parseInput, validation } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/terms.repository.ts';
import { withTransaction, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { classSelectionToCopy } from './place.service.ts';
import { purgeAfterFor } from './retention.service.ts';

export const TERM_MSG = {
  exists: 'มีภาคเรียนนี้อยู่แล้ว',
  scoreFormat: 'คะแนนต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 3 ตำแหน่ง',
  maxPositive: 'คะแนนเต็มต้องมากกว่า 0',
  maxTooLarge: 'คะแนนเต็มต้องไม่เกิน 999.999',
  closedTerm: 'ภาคเรียนนี้ปิดแล้ว ดูข้อมูลได้อย่างเดียว',
  photoRange: 'จำนวนรูปขั้นต่ำต้องไม่มากกว่าขั้นสูง (ไม่เกิน 10 รูป)',
  roundCount: 'จำนวนรอบต้องอยู่ระหว่าง 1–10',
  removeStarted: 'ลดจำนวนรอบไม่ได้ เพราะรอบที่จะลบเปิดไปแล้ว',
  keyTaken: 'รหัสส่วนคะแนนซ้ำกัน',
  activeTerm: 'ภาคเรียนนี้เปิดใช้อยู่แล้ว',
  noComponents: 'ต้องเปิดใช้ส่วนคะแนนอย่างน้อย 1 ส่วน',
  closeNotActive: 'ปิดได้เฉพาะภาคเรียนที่ใช้งานอยู่',
  closeOpenRound: 'ปิดภาคเรียนไม่ได้ เพราะยังมีรอบที่เปิดรับคะแนนอยู่',
} as const;

const scoreText = z
  .string()
  .trim()
  .refine((s) => {
    try {
      parseScore(s);
      return true;
    } catch {
      return false;
    }
  }, TERM_MSG.scoreFormat);
// A pipe only runs numeric checks after parsing succeeds; malformed input must not throw RangeError.
const positiveScore = scoreText.pipe(
  z
    .string()
    .refine((s) => parseScore(s) > 0, TERM_MSG.maxPositive)
    .refine((s) => parseScore(s) <= 999_999, TERM_MSG.maxTooLarge),
);

export const createTermInput = z.object({
  academicYear: z.number().int().min(2560).max(2700),
  termNo: z.number().int().min(1).max(3),
  copyFromTermId: z.uuid().nullable().optional(),
  copyZones: z.boolean().default(true),
  copyDuties: z.boolean().default(false),
});

export const termConfigInput = z
  .object({
    termId: z.uuid(),
    areaType: z.enum(['zone', 'building']),
    roomMode: z.enum(['group', 'individual']),
    areaMode: z.enum(['group', 'individual']),
    scoreFormat: z.enum(['integer', 'decimal']),
    scoreStep: z.enum(DECIMAL_STEPS).default('0.500'),
    finalMax: positiveScore,
    photoMin: z.number().int().min(0).max(10),
    photoMax: z.number().int().min(1).max(10),
    commentMax: z.number().int().min(0).max(2000),
    selfEditHours: z.number().int().min(0).max(240),
    lateEntryDefaultHours: z.number().int().min(1).max(240),
  })
  .refine((v) => v.photoMin <= v.photoMax, { message: TERM_MSG.photoRange, path: ['photoMin'] });

const componentRow = z.object({
  id: z.uuid().optional(),
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,30}$/),
  label: z.string().trim().min(1, 'กรุณากรอกชื่อส่วนคะแนน').max(60),
  unit: z.enum(['class', 'area']),
  source: z.enum(['committee', 'area_teacher']),
  kind: z.enum(['score', 'deduct']),
  maxValue: positiveScore,
  enabled: z.boolean(),
  requiresSignature: z.boolean(),
});

export const scoringInput = z.object({
  termId: z.uuid(),
  components: z.array(componentRow).min(1).max(10),
  /** "ใช้คะแนนเต็มเท่ากันทุกรอบ" — off stores per-round full marks (BR-S4b). */
  equalMax: z.boolean(),
  roundMax: z
    .array(z.object({ roundNo: z.number().int().min(1), key: z.string(), maxValue: positiveScore }))
    .default([]),
  /** "คะแนนเต็มปลายภาคเรียน" lives on the scoring card too (BR-TM3). */
  finalMax: positiveScore.optional(),
});

export const roundCountInput = z.object({
  termId: z.uuid(),
  count: z.number().int().min(1, TERM_MSG.roundCount).max(10, TERM_MSG.roundCount),
});
export const roundDatesInput = z.object({ roundId: z.uuid(), opensAt: z.coerce.date(), closesAt: z.coerce.date() });

/** 08-ux-ui §6.12 defaults for a term created from nothing (2/2569: room 5 + building 10; teacher score off). */
export const DEFAULT_COMPONENTS = [
  {
    key: 'room',
    label: 'คะแนนห้องเรียน',
    unit: 'class',
    source: 'committee',
    kind: 'score',
    maxValue: '5.000',
    enabled: true,
    requiresSignature: true,
  },
  {
    key: 'area',
    label: 'คะแนนอาคาร',
    unit: 'area',
    source: 'committee',
    kind: 'score',
    maxValue: '10.000',
    enabled: true,
    requiresSignature: false,
  },
  {
    key: 'area_teacher',
    label: 'คะแนนจากครูผู้รับผิดชอบ',
    unit: 'area',
    source: 'area_teacher',
    kind: 'score',
    maxValue: '5.000',
    enabled: false,
    requiresSignature: false,
  },
] as const;

/** A new round defaults to the week after the previous one closes: Monday-ish 08:00 → +4 days 16:30 Bangkok. */
export function defaultRoundDates(previousClose: Date | null, now: Date): { opensAt: Date; closesAt: Date } {
  const base = previousClose
    ? new Date(previousClose.getTime() + 28 * 86_400_000)
    : new Date(now.getTime() + 14 * 86_400_000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(base); // yyyy-mm-dd
  const opensAt = new Date(`${day}T08:00:00+07:00`);
  const closesAt = new Date(opensAt.getTime() + 4 * 86_400_000 + 8.5 * 3_600_000);
  return { opensAt, closesAt };
}

async function audit(
  tx: Tx,
  actor: SessionUser,
  meta: ClientMeta,
  now: Date,
  action: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  await writeAudit(tx, { actorId: actor.id, action, entity: 'term', entityId, before, after, ip: meta.ip }, now);
}

async function unlockedTerm(tx: Tx, termId: string) {
  const term = await repo.findTerm(tx, termId);
  if (!term) throw notFound();
  assertTermWritable(term);
  if (term.configLockedAt) throw new AppError('CONFIG_LOCKED');
  return term;
}

/** BR-D1: closing a term preserves its history, including its retention deadline. */
function assertTermWritable(term: repo.TermRow) {
  if (term.status === 'closed' || term.purgedAt) throw validation('termId', TERM_MSG.closedTerm);
}

// ───────────── reads ─────────────

export async function listTerms(db: Db, actor: SessionUser) {
  assertCan(actor, 'staff.read');
  return repo.listTerms(db);
}

export async function getTermSettings(db: Db, actor: SessionUser, termId: string) {
  assertCan(actor, 'staff.read');
  const term = await repo.findTerm(db, termId);
  if (!term) throw notFound();
  const [rounds, components] = await Promise.all([repo.listRounds(db, termId), repo.listComponents(db, termId)]);
  const roundMax = await repo.listRoundMax(
    db,
    rounds.map((r) => r.id),
  );
  return { term, rounds, components, roundMax, equalMax: roundMax.length === 0 };
}

// ───────────── create / activate ─────────────

/** BR-TM1 / BR-TM6: copy config + components (always), zones (default on), class selection (same year), duties (opt-in). */
export async function createTerm(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof createTermInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'term.configure');
  const input = parseInput(createTermInput, raw);
  return withTransaction(db, async (tx) => {
    if (await repo.findTermByYearNo(tx, input.academicYear, input.termNo)) throw validation('termNo', TERM_MSG.exists);
    const source = input.copyFromTermId ? await repo.findTerm(tx, input.copyFromTermId) : null;
    if (input.copyFromTermId && !source) throw notFound();
    const id = newId();
    const copied = source
      ? {
          areaType: source.areaType,
          roomMode: source.roomMode,
          areaMode: source.areaMode,
          scoreFormat: source.scoreFormat,
          scoreStep: source.scoreStep,
          finalMax: source.finalMax,
          selfEditHours: source.selfEditHours,
          lateEntryDefaultHours: source.lateEntryDefaultHours,
          photoMin: source.photoMin,
          photoMax: source.photoMax,
          commentMax: source.commentMax,
          studentLevelEnabled: source.studentLevelEnabled,
          reminderHours: source.reminderHours,
          publicRankingsVisible: source.publicRankingsVisible,
          publicShowLiveScores: source.publicShowLiveScores,
        }
      : { areaType: 'building' as const, finalMax: '15.000' };
    await repo.insertTerm(tx, {
      id,
      academicYear: input.academicYear,
      termNo: input.termNo,
      status: 'draft',
      copiedFromTermId: source?.id ?? null,
      ...copied,
    });

    const components = source
      ? (await repo.listComponents(tx, source.id)).map(({ id: _old, termId: _t, ...c }) => ({ ...c }))
      : DEFAULT_COMPONENTS.map((c, i) => ({ ...c, sortOrder: i + 1 }));
    await repo.insertComponents(
      tx,
      components.map((c) => ({ ...c, id: newId(), termId: id })),
    );

    let classCount = 0;
    if (source) {
      const selection = classSelectionToCopy(source, input, await places.listTermClassIds(tx, source.id));
      await places.replaceTermClasses(tx, id, selection);
      classCount = selection.length;
      if (input.copyZones) {
        const zones = await repo.listTermClassZones(tx, source.id);
        await repo.insertTermClassZones(
          tx,
          zones.map((z) => ({ ...z, termId: id })),
        );
      }
      if (input.copyDuties) {
        const duties = await repo.listDuties(tx, source.id);
        await repo.insertDuties(
          tx,
          duties.map((d) => ({ ...d, id: newId(), termId: id, createdBy: actor.id, createdAt: now })),
        );
      }
    }
    await audit(tx, actor, meta, now, 'term.create', id, undefined, {
      academicYear: input.academicYear,
      termNo: input.termNo,
      copiedFrom: source?.id ?? null,
      copyZones: input.copyZones,
      copyDuties: input.copyDuties,
      classesCopied: classCount,
    });
    return id;
  });
}

/** BR-TM4: one active term; activating closes the previous one (BR-D1 retention clock starts). */
export async function activateTerm(db: Db, actor: SessionUser, raw: { termId: string }, meta: ClientMeta, now: Date) {
  assertCan(actor, 'term.configure');
  const { termId } = parseInput(z.object({ termId: z.uuid() }), raw);
  await withTransaction(db, async (tx) => {
    // Serialize even when there is no active row yet (locking only existing active rows is insufficient).
    await repo.lockActivation(tx);
    const term = await repo.findTerm(tx, termId);
    if (!term) throw notFound();
    assertTermWritable(term);
    if (term.status === 'active') throw validation('termId', TERM_MSG.activeTerm);
    for (const previous of await repo.findActiveTerms(tx)) {
      const purgeAfter = purgeAfterFor(now);
      await repo.updateTerm(tx, previous.id, { status: 'closed', closedAt: now, purgeAfter });
      await audit(
        tx,
        actor,
        meta,
        now,
        'term.close',
        previous.id,
        { status: previous.status },
        { status: 'closed', purgeAfter },
      );
    }
    await repo.updateTerm(tx, term.id, { status: 'active', closedAt: null, purgeAfter: null });
    await audit(tx, actor, meta, now, 'term.activate', term.id, { status: term.status }, { status: 'active' });
  });
}

/**
 * BR-D1: "ปิดภาคเรียน" without opening the next one. The term becomes read-only, leaves the public site and its
 * data is kept until `purge_after` (one year). A round still taking scores must close first.
 */
export async function closeTerm(db: Db, actor: SessionUser, raw: { termId: string }, meta: ClientMeta, now: Date) {
  assertCan(actor, 'term.configure');
  const { termId } = parseInput(z.object({ termId: z.uuid() }), raw);
  return withTransaction(db, async (tx) => {
    await repo.lockActivation(tx);
    const term = await repo.findTerm(tx, termId);
    if (!term) throw notFound();
    if (term.status !== 'active') throw validation('termId', TERM_MSG.closeNotActive);
    if ((await repo.listRounds(tx, termId)).some((r) => r.status === 'open'))
      throw validation('termId', TERM_MSG.closeOpenRound);
    const purgeAfter = purgeAfterFor(now);
    await repo.updateTerm(tx, termId, { status: 'closed', closedAt: now, purgeAfter });
    await audit(tx, actor, meta, now, 'term.close', termId, { status: term.status }, { status: 'closed', purgeAfter });
    return { purgeAfter };
  });
}

// ───────────── config ─────────────

export async function updateTermConfig(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof termConfigInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'term.configure');
  const input = parseInput(termConfigInput, raw);
  await withTransaction(db, async (tx) => {
    const term = await unlockedTerm(tx, input.termId);
    const { termId: _id, ...fields } = input;
    const patch = {
      ...fields,
      scoreStep: input.scoreFormat === 'integer' ? '1.000' : input.scoreStep,
      finalMax: toDb(parseScore(input.finalMax)),
    };
    await repo.updateTerm(tx, term.id, patch);
    await audit(tx, actor, meta, now, 'term.update_config', term.id, term, patch);
  });
}

/** Components table + "ใช้คะแนนเต็มเท่ากันทุกรอบ" + per-round grid (08-ux-ui §6.12 scoring card). */
export async function updateScoring(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof scoringInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'term.configure');
  const input = parseInput(scoringInput, raw);
  const keys = input.components.map((c) => c.key);
  if (new Set(keys).size !== keys.length) throw validation('components', TERM_MSG.keyTaken);
  if (!input.components.some((c) => c.enabled && c.kind === 'score'))
    throw validation('components', TERM_MSG.noComponents);
  await withTransaction(db, async (tx) => {
    const term = await unlockedTerm(tx, input.termId);
    const before = await repo.listComponents(tx, term.id);
    const keep = new Set(input.components.map((c) => c.id).filter(Boolean));
    await repo.deleteComponents(
      tx,
      before.filter((c) => !keep.has(c.id)).map((c) => c.id),
    );
    const idByKey = new Map<string, string>();
    for (const [i, c] of input.components.entries()) {
      const fields = { ...c, maxValue: toDb(parseScore(c.maxValue)), sortOrder: i + 1 };
      if (c.id && before.some((b) => b.id === c.id)) {
        await repo.updateComponent(tx, c.id, fields);
        idByKey.set(c.key, c.id);
      } else {
        const id = newId();
        await repo.insertComponents(tx, [{ ...fields, id, termId: term.id }]);
        idByKey.set(c.key, id);
      }
    }
    const rounds = await repo.listRounds(tx, term.id);
    const roundIdByNo = new Map(rounds.map((r) => [r.roundNo, r.id]));
    const rows = input.equalMax
      ? []
      : rounds.flatMap((r) =>
          input.components
            .filter((c) => c.enabled)
            .map((c) => {
              const given = input.roundMax.find((m) => m.roundNo === r.roundNo && m.key === c.key);
              return {
                roundId: r.id,
                componentId: idByKey.get(c.key)!,
                maxValue: toDb(parseScore(given?.maxValue ?? c.maxValue)),
              };
            }),
        );
    if (input.roundMax.some((m) => !roundIdByNo.has(m.roundNo)))
      throw validation('roundMax', 'มีรอบที่ไม่อยู่ในภาคเรียนนี้');
    await repo.replaceRoundMax(
      tx,
      rounds.map((r) => r.id),
      rows,
    );
    if (input.finalMax) await repo.updateTerm(tx, term.id, { finalMax: toDb(parseScore(input.finalMax)) });
    await audit(
      tx,
      actor,
      meta,
      now,
      'term.update_scoring',
      term.id,
      { components: before },
      { components: input.components, equalMax: input.equalMax, roundMax: rows.length },
    );
  });
}

// ───────────── rounds ─────────────

/** "จำนวนรอบต่อภาคเรียน" stepper: adds rounds after the last one, removes from the end (only rounds not yet opened). */
export async function setRoundCount(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof roundCountInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'term.configure');
  const input = parseInput(roundCountInput, raw);
  await withTransaction(db, async (tx) => {
    const term = await unlockedTerm(tx, input.termId);
    const rounds = await repo.listRounds(tx, term.id);
    if (input.count === rounds.length) return;
    if (input.count < rounds.length) {
      const remove = rounds.slice(input.count);
      if (remove.some((r) => r.status !== 'scheduled')) throw validation('count', TERM_MSG.removeStarted);
      await repo.deleteRounds(
        tx,
        remove.map((r) => r.id),
      );
    } else {
      let last = rounds.at(-1)?.closesAt ?? null;
      const add = [];
      for (let no = rounds.length + 1; no <= input.count; no++) {
        const dates = defaultRoundDates(last, now);
        add.push({ id: newId(), termId: term.id, roundNo: no, ...dates });
        last = dates.closesAt;
      }
      await repo.insertRounds(tx, add);
      // per-round full marks already in use → the new rounds start from the component maxima
      const existing = await repo.listRoundMax(
        tx,
        rounds.map((r) => r.id),
      );
      if (existing.length > 0) {
        const components = (await repo.listComponents(tx, term.id)).filter((c) => c.enabled);
        const all = [
          ...existing,
          ...add.flatMap((r) => components.map((c) => ({ roundId: r.id, componentId: c.id, maxValue: c.maxValue }))),
        ];
        await repo.replaceRoundMax(
          tx,
          [...rounds, ...add].map((r) => r.id),
          all,
        );
      }
    }
    await audit(
      tx,
      actor,
      meta,
      now,
      'term.set_round_count',
      term.id,
      { count: rounds.length },
      { count: input.count },
    );
  });
}

/** BR-R5 (not gated by the config lock: closing dates may be extended mid-term). */
export async function updateRoundDates(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof roundDatesInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'round.manage');
  const input = parseInput(roundDatesInput, raw);
  await withTransaction(db, async (tx) => {
    const round = await repo.findRound(tx, input.roundId);
    if (!round) throw notFound();
    const term = await repo.findTerm(tx, round.termId);
    if (!term) throw notFound();
    assertTermWritable(term);
    const problem = checkRoundDateChange(round, input, now);
    if (problem) throw validation('closesAt', problem);
    // extending a closed round's deadline into the future opens it again (the round keeps its frozen areas)
    const reopen = round.status === 'closed' && input.closesAt > now;
    await repo.updateRound(tx, round.id, {
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      ...(reopen ? { status: 'open' as const } : {}),
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'round.update_dates',
        entity: 'round',
        entityId: round.id,
        before: { opensAt: round.opensAt, closesAt: round.closesAt, status: round.status },
        after: { opensAt: input.opensAt, closesAt: input.closesAt, status: reopen ? 'open' : round.status },
        ip: meta.ip,
      },
      now,
    );
  });
}

/**
 * The components that take part in a term (enabled only). Committee forms, targets, results and readiness
 * checks must load components through this, so a disabled component never appears anywhere.
 */
export async function componentsInUseForTerm(db: Db | Tx, termId: string) {
  return componentsInUse(await repo.listComponents(db, termId));
}
