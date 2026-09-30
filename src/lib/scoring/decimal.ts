/**
 * Exact decimal helpers for scores (BR-N1..N3).
 * A score is an integer number of thousandths: 4.5 → 4500. Never use floats for arithmetic.
 */

export type Th = number; // integer thousandths, always a safe integer

const RE = /^(\d+)(?:\.(\d{1,3}))?$/;

/** Parse "4.5", "4.500", 4.5 or "13" into thousandths. Throws on negative, NaN or > 3 decimals. */
export function parseScore(input: string | number): Th {
  const s = typeof input === 'number' ? input.toString() : input.trim();
  const m = RE.exec(s);
  if (!m) throw new RangeError(`Invalid score "${input}"`);
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(3, '0'));
  const th = whole * 1000 + frac;
  if (!Number.isSafeInteger(th)) throw new RangeError(`Score too large "${input}"`);
  return th;
}

/** Database numeric(6,3) string from thousandths. */
export function toDb(th: Th): string {
  const sign = th < 0 ? '-' : '';
  const a = Math.abs(th);
  return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`;
}

/** Display / export value: half-up to 2 decimals (BR-N3). 13333 → "13.33", 13335 → "13.34". */
export function toDisplay(th: Th): string {
  if (th < 0) return '-' + toDisplay(-th);
  const hundredths = Math.floor((th + 5) / 10);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

/** round_half_up(a * b / c) in thousandths, computed exactly with BigInt. a, b, c ≥ 0, c > 0. */
export function mulDiv(a: Th, b: number, c: number): Th {
  if (c <= 0) throw new RangeError('Division by zero');
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const q = num / den;
  const r = num % den;
  return Number(r * 2n >= den ? q + 1n : q);
}

/** Mean of thousandths values, half-up at the thousandth. Empty → null. */
export function mean(values: readonly Th[]): Th | null {
  if (values.length === 0) return null;
  const sum = values.reduce((s, v) => s + v, 0);
  return mulDiv(sum, 1, values.length);
}
