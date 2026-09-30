/**
 * Pure scoring rules — docs/04-business-rules.md §1 and §7.
 * No I/O. Services load data, call these, and persist the results.
 */
import { mean, mulDiv, type Th } from './decimal.ts';

export type ComponentKind = 'score' | 'deduct';
export type ComponentUnit = 'class' | 'area';

// ───────────── BR-N2: score validity ─────────────
export type ScoreCheck = { ok: true } | { ok: false; code: 'required' | 'range' | 'step' };

/** `value` null/undefined = the committee member has not chosen a score (0 must be chosen explicitly). */
export function checkScore(value: Th | null | undefined, max: Th, step: Th): ScoreCheck {
  if (value === null || value === undefined) return { ok: false, code: 'required' };
  if (value < 0 || value > max) return { ok: false, code: 'range' };
  if (value % step !== 0) return { ok: false, code: 'step' };
  return { ok: true };
}

// ───────────── BR-S2/S3: round total ─────────────
export interface AppliedComponent {
  kind: ComponentKind;
  unit: ComponentUnit;
  max: Th;
  /** Approved value for this class in this round; null = not approved yet. For deduct: sum of approved deductions. */
  value: Th | null;
}

export interface RoundTotal {
  classScore: Th;
  areaScore: Th;
  deduction: Th;
  total: Th;
}

/**
 * Sum the applicable components of one class in one round.
 * Returns null when any applicable component has no approved value (the class shows "รอผล").
 * Deductions are capped at the component max and the total never goes below 0.
 */
export function roundTotal(components: readonly AppliedComponent[]): RoundTotal | null {
  if (components.length === 0) return null;
  let classScore = 0;
  let areaScore = 0;
  let deduction = 0;
  for (const c of components) {
    if (c.value === null) return null;
    if (c.kind === 'deduct') {
      deduction += Math.min(c.value, c.max);
    } else if (c.unit === 'class') {
      classScore += c.value;
    } else {
      areaScore += c.value;
    }
  }
  const total = Math.max(0, classScore + areaScore - deduction);
  return { classScore, areaScore, deduction, total };
}

/** Individual mode (BR-S2): class room score used for ranking = mean of snapshot students' scores. */
export function individualClassValue(studentScores: readonly Th[]): Th | null {
  return mean(studentScores);
}

// ───────────── BR-S4: term score ─────────────
/**
 * @param roundTotals  one entry per round of the term; null = no total for that round
 * @param maxSum       Σ max of applicable `score` components (e.g. 5 + 10 = 15)
 * @param finalMax     term maximum configured by admin (e.g. 15 or 20)
 * @returns thousandths, or null when no round has a total ("ยังไม่มีคะแนน", never 0)
 */
export function termScore(roundTotals: readonly (Th | null)[], maxSum: Th, finalMax: Th): Th | null {
  const present = roundTotals.filter((t): t is Th => t !== null);
  if (present.length === 0) return null;
  const sum = present.reduce((s, v) => s + v, 0);
  // (sum / n) × finalMax / maxSum, computed in one exact step to avoid double rounding.
  return mulDiv(sum, finalMax, present.length * maxSum);
}

// ───────────── BR-S4b: term score when rounds have different maximums ─────────────
export interface RoundResultForTerm {
  /** round total (thousandths) or null when the round has no total */
  total: Th | null;
  /** Σ max of applicable `score` components in THAT round (per-round overrides applied) */
  max: Th;
}

/**
 * Equal round weights (FR-R5) even when rounds have different full marks:
 *   termScore = mean over rounds with a total of (total_i / max_i)  ×  finalMax
 * Computed as one exact rational (BigInt) and rounded half-up once at the thousandth.
 * When every round has the same max this equals `termScore()` above.
 */
export function termScoreByRound(rounds: readonly RoundResultForTerm[], finalMax: Th): Th | null {
  const present = rounds.filter((r): r is { total: Th; max: Th } => r.total !== null);
  if (present.length === 0) return null;
  if (present.some((r) => r.max <= 0)) throw new RangeError('Round max must be > 0');
  const den = present.reduce((d, r) => d * BigInt(r.max), 1n);
  const num = present.reduce((n, r) => n + BigInt(r.total) * BigInt(finalMax) * (den / BigInt(r.max)), 0n);
  const fullDen = den * BigInt(present.length);
  const q = num / fullDen;
  const rem = num % fullDen;
  return Number(rem * 2n >= fullDen ? q + 1n : q);
}

// ───────────── BR-S5: competition ranking ─────────────
export interface Rankable {
  id: string;
  score: Th | null;
}

/**
 * Competition ranking at thousandths: 14.5, 14.5, 13 → 1, 1, 3. Null scores are unranked (null).
 * Output keeps ranked items first (score desc, then input order for ties), then unranked in input order.
 */
export function competitionRank<T extends Rankable>(items: readonly T[]): Array<T & { rank: number | null }> {
  const ranked = items
    .map((it, i) => ({ it, i }))
    .filter((x) => x.it.score !== null)
    .sort((a, b) => (b.it.score as Th) - (a.it.score as Th) || a.i - b.i);
  const out: Array<T & { rank: number | null }> = [];
  let prev: Th | null = null;
  let prevRank = 0;
  ranked.forEach((x, idx) => {
    const rank = x.it.score === prev ? prevRank : idx + 1;
    prev = x.it.score;
    prevRank = rank;
    out.push({ ...x.it, rank });
  });
  for (const it of items) if (it.score === null) out.push({ ...it, rank: null });
  return out;
}

// ───────────── BR-S6: student-level results ─────────────
export interface StudentRoundInput {
  roundNo: number;
  /** class the student was in for that round (from roster_snapshots); null = not in that round's snapshot */
  classId: string | null;
}

/**
 * Per-student round totals follow the class the student was in *in that round* (FR-R9).
 * `classTotals` maps `${roundNo}:${classId}` → class round total (or null).
 */
export function studentRoundTotals(
  rounds: readonly StudentRoundInput[],
  classTotals: ReadonlyMap<string, Th | null>,
): (Th | null)[] {
  return rounds.map((r) => (r.classId === null ? null : classTotals.get(`${r.roundNo}:${r.classId}`) ?? null));
}
