/**
 * Golden tests for docs/04-business-rules.md. IDs match docs/13-testing.md.
 * In the project:     pnpm test   (Vitest)
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseScore as p, toDisplay, toDb, mulDiv, mean } from './decimal.ts';
import { checkScore, roundTotal, termScore, termScoreByRound, competitionRank, individualClassValue, studentRoundTotals, type AppliedComponent } from './index.ts';
import { classLookupKey, homeClassKey, parseGeneralClass } from './classKey.ts';

const room = (v: number | null, max = 5): AppliedComponent => ({ kind: 'score', unit: 'class', max: p(max), value: v === null ? null : p(v) });
const area = (v: number | null, max = 10): AppliedComponent => ({ kind: 'score', unit: 'area', max: p(max), value: v === null ? null : p(v) });
const ded = (v: number | null, max = 3): AppliedComponent => ({ kind: 'deduct', unit: 'area', max: p(max), value: v === null ? null : p(v) });

// ── BR-N ──
test('N1 parse and format exact decimals', () => {
  assert.equal(p('4.5'), 4500);
  assert.equal(p(13), 13000);
  assert.equal(p('0.125'), 125);
  assert.throws(() => p('1.2345'));
  assert.throws(() => p('-1'));
  assert.equal(toDb(4500), '4.500');
});

test('N3 display rounds half-up to 2 decimals', () => {
  assert.equal(toDisplay(13000), '13.00');
  assert.equal(toDisplay(13333), '13.33');
  assert.equal(toDisplay(13335), '13.34');
  assert.equal(toDisplay(17333), '17.33');
  assert.equal(toDisplay(0), '0.00');
});

test('N2 score validity: required, range, step', () => {
  assert.deepEqual(checkScore(null, p(5), p(0.5)), { ok: false, code: 'required' });
  assert.deepEqual(checkScore(0, p(5), p(0.5)), { ok: true }); // 0 typed explicitly is valid
  assert.deepEqual(checkScore(p(5.5), p(5), p(0.5)), { ok: false, code: 'range' });
  assert.deepEqual(checkScore(p(4.25), p(5), p(0.5)), { ok: false, code: 'step' });
  assert.deepEqual(checkScore(p(4.5), p(5), p(1)), { ok: false, code: 'step' }); // integer format
  assert.deepEqual(checkScore(p(4), p(5), p(1)), { ok: true });
});

// ── BR-S3 ──
test('S3 round total = room + area', () => {
  assert.deepEqual(roundTotal([room(4), area(9)]), { classScore: 4000, areaScore: 9000, deduction: 0, total: 13000 });
});

test('S3 missing approved component → no total ("รอผล")', () => {
  assert.equal(roundTotal([room(4), area(null)]), null);
  assert.equal(roundTotal([]), null);
});

test('S3 deduction capped at its max and total never below 0', () => {
  assert.equal(roundTotal([room(4), area(9), ded(5, 3)])!.total, 10000); // 13 − min(5,3)
  assert.equal(roundTotal([room(0), area(1), ded(3, 3)])!.total, 0);    // 1 − 3 → 0
});

// ── BR-S4 (G1 worked example) ──
test('G1 term score: (13+12+14)/3 × 15/15 = 13.00', () => {
  const t = termScore([p(13), p(12), p(14)], p(15), p(15));
  assert.equal(toDisplay(t!), '13.00');
});

test('G1b round without total is excluded: (13+14)/2 = 13.50', () => {
  assert.equal(toDisplay(termScore([p(13), null, p(14)], p(15), p(15))!), '13.50');
});

test('G1c scaling to final max 20: 13 × 20/15 = 17.33', () => {
  assert.equal(toDisplay(termScore([p(13), p(12), p(14)], p(15), p(20))!), '17.33');
});

test('S4 no rounds with a total → null, never 0', () => {
  assert.equal(termScore([null, null, null], p(15), p(15)), null);
});

test('S4 single rounding step (no double rounding)', () => {
  // (10 + 10 + 11)/3 = 10.3333… ; ×20/15 = 13.7777… → 13.778 thousandths → "13.78"
  const t = termScore([p(10), p(10), p(11)], p(15), p(20))!;
  assert.equal(t, 13778);
  assert.equal(toDisplay(t), '13.78');
});

// ── BR-S4b rounds with different full marks ──
test('S4b equal maxima give the same result as termScore', () => {
  const r = termScoreByRound([{ total: p(13), max: p(15) }, { total: p(12), max: p(15) }, { total: p(14), max: p(15) }], p(15));
  assert.equal(r, termScore([p(13), p(12), p(14)], p(15), p(15)));
  assert.equal(toDisplay(r!), '13.00');
});

test('S4b different round maxima: rounds weigh equally as percentages', () => {
  // R1 12/15 = 80 %, R2 18/20 = 90 %  → mean 85 % × 15 = 12.75
  const r = termScoreByRound([{ total: p(12), max: p(15) }, { total: p(18), max: p(20) }], p(15));
  assert.equal(toDisplay(r!), '12.75');
});

test('S4b round without total is skipped; all null → null', () => {
  assert.equal(toDisplay(termScoreByRound([{ total: p(12), max: p(15) }, { total: null, max: p(20) }], p(15))!), '12.00');
  assert.equal(termScoreByRound([{ total: null, max: p(15) }], p(15)), null);
});

// ── BR-S5 ──
test('S5 competition ranking with ties: 14.5, 14.5, 13 → 1, 1, 3', () => {
  const r = competitionRank([
    { id: 'a', score: p(13) },
    { id: 'b', score: p(14.5) },
    { id: 'c', score: p(14.5) },
  ]);
  assert.deepEqual(r.map((x) => [x.id, x.rank]), [['b', 1], ['c', 1], ['a', 3]]);
});

test('S5 compare at thousandths, not display value', () => {
  const r = competitionRank([{ id: 'x', score: 13333 }, { id: 'y', score: 13334 }]);
  assert.deepEqual(r.map((x) => [x.id, x.rank]), [['y', 1], ['x', 2]]); // both display 13.33
});

test('S5 unscored classes are listed last, unranked', () => {
  const r = competitionRank([{ id: 'n', score: null }, { id: 'a', score: p(1) }]);
  assert.deepEqual(r.map((x) => [x.id, x.rank]), [['a', 1], ['n', null]]);
});

// ── BR-S2 individual mode ──
test('S2 individual mode class value = mean of snapshot students', () => {
  assert.equal(individualClassValue([p(4), p(5), p(4.5)]), p(4.5));
  assert.equal(individualClassValue([p(4), p(5), p(5)]), 4667); // 4.6666… → 4.667
  assert.equal(individualClassValue([]), null);
});

// ── BR-S6 student moved class ──
test('S6 moved student keeps round 1 from old class', () => {
  const totals = new Map<string, number | null>([
    ['1:amanah', p(13)], ['2:amanah', p(10)], ['3:amanah', p(10)],
    ['1:berdikari', p(9)], ['2:berdikari', p(14)], ['3:berdikari', p(12)],
  ]);
  const rounds = [
    { roundNo: 1, classId: 'amanah' },
    { roundNo: 2, classId: 'berdikari' },
    { roundNo: 3, classId: 'berdikari' },
  ];
  const t = studentRoundTotals(rounds, totals);
  assert.deepEqual(t, [p(13), p(14), p(12)]);
  assert.equal(toDisplay(termScore(t, p(15), p(15))!), '13.00');
});

test('S6 student who joined in round 2 has fewer rounds', () => {
  const totals = new Map([['2:a', p(12)], ['3:a', p(15)]]);
  const t = studentRoundTotals([{ roundNo: 1, classId: null }, { roundNo: 2, classId: 'a' }, { roundNo: 3, classId: 'a' }], totals);
  assert.equal(toDisplay(termScore(t, p(15), p(15))!), '13.50');
});

// ── helpers ──
test('mulDiv and mean are exact and half-up', () => {
  assert.equal(mulDiv(1, 1, 2), 1);        // 0.5 → 1
  assert.equal(mulDiv(1, 1, 3), 0);        // 0.333 → 0
  assert.equal(mean([1, 2]), 2);           // 1.5 → 2
  assert.equal(mean([]), null);
});

// ── BR-Y §9.2 class strings ──
test('Y9.2 general class parsing', () => {
  assert.deepEqual(parseGeneralClass('ม.1/1 Amanah'), { gradeLabel: 'ม.1', roomNo: 1, name: 'Amanah' });
  assert.deepEqual(parseGeneralClass('  ม. 2 / 13  Zikir '), { gradeLabel: 'ม.2', roomNo: 13, name: 'Zikir' });
  assert.equal(parseGeneralClass('ปวช.2/1'), null);
});

test('Y9.2 lookup keys', () => {
  assert.equal(classLookupKey('ม.1/10 Usaha'), 'ม.1|usaha');
  assert.equal(classLookupKey('ม.4/6 Ash-Shafi’i'), "ม.4|ash-shafi'i");
  assert.equal(classLookupKey('PR 1/1 Amanah'), 'pr1|amanah');
  assert.equal(classLookupKey('อก.1/3 Cergas'), 'อก.1|cergas');
  assert.equal(classLookupKey('ปวช.2/1'), 'ปวช.2|ปวช.2/1');
  assert.equal(classLookupKey('2S Muslim'), '2s muslim');
  assert.equal(classLookupKey(''), null);
  assert.equal(classLookupKey('-'), null);
});

test('R10 home class: general first, else religious', () => {
  assert.equal(homeClassKey('ม.1/1 Amanah', 'PR 1/1 Amanah'), 'ม.1|amanah');
  assert.equal(homeClassKey('', '2S Muslim'), '2s muslim');
  assert.equal(homeClassKey(null, null), null);
});
