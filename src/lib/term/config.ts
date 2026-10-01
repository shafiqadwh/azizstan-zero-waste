/**
 * Pure term-configuration rules (FR-C*, BR-TM3, BR-R5, BR-S4b). No I/O: services load rows, call these,
 * and every later feature (committee form, targets, results, readiness) uses the same functions.
 */
import { parseScore, toDisplay, type Th } from '../scoring/decimal.ts';

export interface TermScoring {
  scoreFormat: 'integer' | 'decimal';
  scoreStep: string; // numeric(6,3) from the DB, e.g. "0.500"
  finalMax: string;
}

export interface ComponentLike {
  id: string;
  kind: 'score' | 'deduct';
  maxValue: string;
  enabled: boolean;
}

/** FR-C4: integer → step 1; decimal → the configured step (0.5 / 0.25 / 0.1). Thousandths. */
export function scoreStepFor(term: Pick<TermScoring, 'scoreFormat' | 'scoreStep'>): Th {
  return term.scoreFormat === 'integer' ? 1000 : parseScore(term.scoreStep);
}

export const DECIMAL_STEPS = ['0.500', '0.250', '0.100'] as const;

/**
 * Components that take part in the term. A disabled component (e.g. the zone-teacher score, off in 2/2569) is kept
 * in the config but must never appear in forms, targets, results or readiness checks — always filter through here.
 */
export function componentsInUse<C extends Pick<ComponentLike, 'enabled'>>(components: readonly C[]): C[] {
  return components.filter((c) => c.enabled);
}

/** Σ full marks of the enabled `score` components (deductions are not part of full marks). */
export function perRoundMax(components: readonly ComponentLike[], overrides?: ReadonlyMap<string, string>): Th {
  return componentsInUse(components)
    .filter((c) => c.kind === 'score')
    .reduce((sum, c) => sum + parseScore(overrides?.get(c.id) ?? c.maxValue), 0);
}

/**
 * BR-S4b: each round's Σ max with per-round overrides applied (`round_component_max`; no row = component max).
 * Feed the result to `termScoreByRound`.
 */
export function roundMaxima(
  roundIds: readonly string[],
  components: readonly ComponentLike[],
  overrides: readonly { roundId: string; componentId: string; maxValue: string }[],
): Map<string, Th> {
  return new Map(
    roundIds.map((roundId) => {
      const own = new Map(overrides.filter((o) => o.roundId === roundId).map((o) => [o.componentId, o.maxValue]));
      return [roundId, perRoundMax(components, own)];
    }),
  );
}

/** BR-TM3: shown next to the term maximum when it differs from the per-round sum. */
export function scalingNote(components: readonly ComponentLike[], finalMax: string): string | null {
  const sum = perRoundMax(components);
  const target = parseScore(finalMax);
  if (sum === 0 || sum === target) return null;
  return `คะแนนจะถูกแปลงเป็นเต็ม ${trimScore(toDisplay(target))}`;
}

/** "15.00" → "15", "12.50" → "12.5" for labels. */
export function trimScore(display: string): string {
  return display.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export type RoundStatus = 'scheduled' | 'open' | 'closed' | 'finalized';

/**
 * BR-R5: dates are free while `scheduled`; while `open`/`closed` only `closes_at` may move, and only later
 * (never before now); a finalized round is fixed. Returns a Thai message, or null when the change is allowed.
 */
export function checkRoundDateChange(
  round: { status: RoundStatus; opensAt: Date; closesAt: Date },
  next: { opensAt: Date; closesAt: Date },
  now: Date,
): string | null {
  if (next.closesAt.getTime() <= next.opensAt.getTime()) return 'วันปิดรับคะแนนต้องหลังวันเปิด';
  if (round.status === 'scheduled') return null;
  if (round.status === 'finalized') return 'รอบนี้ปิดรอบแล้ว แก้วันที่ไม่ได้';
  if (next.opensAt.getTime() !== round.opensAt.getTime()) return 'รอบนี้เปิดแล้ว แก้ได้เฉพาะวันปิดรับคะแนน';
  if (next.closesAt.getTime() < round.closesAt.getTime()) return 'ขยายวันปิดรับคะแนนได้ แต่เลื่อนให้เร็วขึ้นไม่ได้';
  if (next.closesAt.getTime() < now.getTime()) return 'วันปิดรับคะแนนต้องไม่อยู่ในอดีต';
  return null;
}
