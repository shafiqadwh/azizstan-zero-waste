/**
 * Public read models (05-api §3.1, 08-ux-ui §6.1–6.4, T24). No login, approved data only, and never a person:
 * no evaluator, approver or student names and no photos — only classes, areas, rounds and scores.
 * Values that cross the cache (`unstable_cache` serialises to JSON) are plain strings and numbers.
 */
import type { Db } from '../../../db/client.ts';
import { bangkokDateString } from '../../lib/dates/index.ts';
import { competitionRank, termScoreByRound } from '../../lib/scoring/index.ts';
import { toDisplay, type Th } from '../../lib/scoring/decimal.ts';
import { trimScore } from '../../lib/term/config.ts';
import * as places from '../repositories/places.repository.ts';
import * as roundsRepo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as contentRepo from '../repositories/content.repository.ts';
import { getRoundResults, getTermResults, type RoundResults } from './result.service.ts';
import { currentRound } from './task.service.ts';

const show = (th: Th | null) => (th === null ? null : trimScore(toDisplay(th)));

export interface PublicTerm {
  id: string;
  termNo: number;
  academicYear: number;
  areaWord: 'อาคาร' | 'โซน';
}

export interface PublicRound {
  roundNo: number;
  status: 'scheduled' | 'open' | 'closed' | 'finalized';
  opensAt: string;
  closesAt: string;
}

export interface PublicSummary {
  term: PublicTerm | null;
  round: PublicRound | null;
  rounds: PublicRound[];
  progress: { classesDone: number; classesTotal: number; areasDone: number; areasTotal: number };
  allFinalized: boolean;
}

const termView = (t: places.TermRow): PublicTerm => ({
  id: t.id,
  termNo: t.termNo,
  academicYear: t.academicYear,
  areaWord: t.areaType === 'zone' ? 'โซน' : 'อาคาร',
});
const roundView = (r: termsRepo.RoundRow): PublicRound => ({
  roundNo: r.roundNo,
  status: r.status,
  opensAt: r.opensAt.toISOString(),
  closesAt: r.closesAt.toISOString(),
});

/** Classes and areas that have every approved score of the round (the home progress card). */
function progressOf(results: RoundResults) {
  const missingClass = new Set(results.missing.filter((m) => m.targetType === 'class').map((m) => m.targetId));
  const missingArea = new Set(results.missing.filter((m) => m.targetType === 'area').map((m) => m.targetId));
  const usedAreas = [...new Set(results.classes.map((c) => c.areaId).filter((a): a is string => a !== null))];
  return {
    classesDone: results.classes.filter((c) => !missingClass.has(c.classId)).length,
    classesTotal: results.classes.length,
    areasDone: usedAreas.filter((a) => !missingArea.has(a)).length,
    areasTotal: usedAreas.length,
  };
}

/** GET /public/summary — §6.1 round status card. */
export async function getPublicSummary(db: Db, now: Date): Promise<PublicSummary> {
  const empty = { classesDone: 0, classesTotal: 0, areasDone: 0, areasTotal: 0 };
  const term = await places.findActiveTerm(db);
  if (!term) return { term: null, round: null, rounds: [], progress: empty, allFinalized: false };
  const rounds = await termsRepo.listRounds(db, term.id);
  const round = currentRound(rounds, now);
  const progress = round && round.status !== 'scheduled' ? progressOf(await getRoundResults(db, round.id)) : empty;
  return {
    term: termView(term),
    round: round ? roundView(round) : null,
    rounds: rounds.map(roundView),
    progress,
    allFinalized: rounds.length > 0 && rounds.every((r) => r.status === 'finalized'),
  };
}

// ───────────── rankings (§6.2) ─────────────

export interface RankRow {
  rank: number | null;
  classId: string;
  display: string;
  roomNumber: string | null;
  /** "14.5"; null = "รอผล" */
  score: string | null;
}

export interface AreaRankRow {
  rank: number | null;
  areaId: string;
  name: string;
  score: string | null;
}

export interface Rankings {
  term: PublicTerm | null;
  rounds: PublicRound[];
  /** null = "สะสมทั้งเทอม" */
  roundNo: number | null;
  groups: { group: string; rows: RankRow[] }[];
  areas: AreaRankRow[];
  /** for the empty state "ยังไม่มีคะแนนที่อนุมัติ" */
  closesAt: string | null;
  hasScores: boolean;
}

/** Room number of each class: frozen in the round, else today's link. */
async function roomNumbers(db: Db, roundId: string | null, now: Date) {
  const [rooms, frozen, links] = await Promise.all([
    places.listRooms(db),
    roundId ? roundsRepo.listRoundClassAreas(db, roundId) : Promise.resolve([]),
    places.listLinksOnDate(db, bangkokDateString(now)),
  ]);
  const roomById = new Map(rooms.map((r) => [r.id, r.roomNumber]));
  const out = new Map<string, string>();
  for (const l of links) {
    const n = roomById.get(l.physicalRoomId);
    if (n) out.set(l.classId, n);
  }
  for (const f of frozen) {
    const n = f.physicalRoomId ? roomById.get(f.physicalRoomId) : undefined;
    if (n) out.set(f.classId, n);
  }
  return out;
}

/** GET /public/rankings?view=round|term&roundNo= — top lists per rank group, areas in one list (BR-S5). */
export async function getRankings(db: Db, opts: { roundNo?: number | null }, now: Date): Promise<Rankings> {
  const term = await places.findActiveTerm(db);
  if (!term) return { term: null, rounds: [], roundNo: null, groups: [], areas: [], closesAt: null, hasScores: false };
  const all = await termsRepo.listRounds(db, term.id);
  const started = all.filter((r) => r.status !== 'scheduled');
  const round = opts.roundNo ? (started.find((r) => r.roundNo === opts.roundNo) ?? null) : null;
  const classes = await places.listClasses(db);
  const classById = new Map(classes.map((c) => [c.id, c]));
  const areaById = new Map((await places.listAreas(db)).map((a) => [a.id, a]));
  const latest = started.at(-1) ?? null;
  const rooms = await roomNumbers(db, (round ?? latest)?.id ?? null, now);

  let classRows: { classId: string; rankGroup: string; score: Th | null; rank: number | null }[] = [];
  let areaRows: { areaId: string; score: Th | null; rank: number | null }[] = [];
  if (round) {
    const r = await getRoundResults(db, round.id);
    classRows = r.classes.map((c) => ({ classId: c.classId, rankGroup: c.rankGroup, score: c.total, rank: c.rank }));
    areaRows = r.areas.map((a) => ({ areaId: a.areaId, score: a.score, rank: a.rank }));
  } else if (started.length > 0) {
    const t = await getTermResults(db, term.id);
    classRows = t.classes.map((c) => ({
      classId: c.classId,
      rankGroup: c.rankGroup,
      score: c.termScore,
      rank: c.rank,
    }));
    // areas: equal round weights scaled to the area's latest max, like the class term score
    const per: RoundResults[] = [];
    for (const s of started) per.push(await getRoundResults(db, s.id));
    const ids = [...new Set(per.flatMap((p) => p.areas.map((a) => a.areaId)))];
    const scored = ids.map((areaId) => {
      const rows = per.map((p) => p.areas.find((a) => a.areaId === areaId)).filter((a) => a && a.max > 0);
      const max = rows.at(-1)?.max ?? 0;
      return {
        areaId,
        id: areaId,
        score:
          max > 0
            ? termScoreByRound(
                rows.map((a) => ({ total: a!.score, max: a!.max })),
                max,
              )
            : null,
      };
    });
    areaRows = competitionRank(scored).map(({ areaId, score, rank }) => ({ areaId, score, rank }));
  }

  const order = [...new Set(classes.map((c) => c.rankGroup))];
  const groups = order
    .map((group) => ({
      group,
      rows: classRows
        .filter((c) => c.rankGroup === group)
        .map((c) => ({
          rank: c.rank,
          classId: c.classId,
          display: classById.get(c.classId)?.displayName ?? '–',
          roomNumber: rooms.get(c.classId) ?? null,
          score: show(c.score),
        })),
    }))
    .filter((g) => g.rows.length > 0);
  return {
    term: termView(term),
    rounds: all.map(roundView),
    roundNo: round?.roundNo ?? null,
    groups,
    areas: areaRows.map((a) => ({
      rank: a.rank,
      areaId: a.areaId,
      name: areaById.get(a.areaId)?.name ?? '–',
      score: show(a.score),
    })),
    closesAt: (round ?? currentRound(all, now))?.closesAt.toISOString() ?? null,
    hasScores: classRows.some((c) => c.score !== null) || areaRows.some((a) => a.score !== null),
  };
}

// ───────────── classes (§6.3) ─────────────

export interface PublicClass {
  classId: string;
  grade: string;
  display: string;
  roomNumber: string | null;
}

/** GET /public/classes — the classes of the active term with their room numbers, in school order. */
export async function listPublicClasses(db: Db, now: Date): Promise<PublicClass[]> {
  const term = await places.findActiveTerm(db);
  if (!term) return [];
  const selected = new Set(await places.listTermClassIds(db, term.id));
  const rounds = (await termsRepo.listRounds(db, term.id)).filter((r) => r.status !== 'scheduled');
  const rooms = await roomNumbers(db, rounds.at(-1)?.id ?? null, now);
  return (await places.listClasses(db))
    .filter((c) => selected.has(c.id))
    .map((c) => ({ classId: c.id, grade: c.rankGroup, display: c.displayName, roomNumber: rooms.get(c.id) ?? null }));
}

export interface ClassScores {
  classId: string;
  display: string;
  roomNumber: string | null;
  areaWord: 'อาคาร' | 'โซน';
  rounds: { roundNo: number; classScore: string | null; areaScore: string | null; total: string | null }[];
  termScore: string | null;
}

/** GET /public/classes/{id}/scores — rounds × (ห้อง, อาคาร/โซน, รวม) and the term score. */
export async function getClassScores(db: Db, classId: string, now: Date): Promise<ClassScores | null> {
  const term = await places.findActiveTerm(db);
  if (!term) return null;
  if (!(await places.listTermClassIds(db, term.id)).includes(classId)) return null;
  const cls = await places.findClass(db, classId);
  if (!cls) return null;
  const rounds = (await termsRepo.listRounds(db, term.id)).filter((r) => r.status !== 'scheduled');
  const rooms = await roomNumbers(db, rounds.at(-1)?.id ?? null, now);
  const out: ClassScores['rounds'] = [];
  for (const r of rounds) {
    const c = (await getRoundResults(db, r.id)).classes.find((x) => x.classId === classId);
    const done = c && c.total !== null;
    out.push({
      roundNo: r.roundNo,
      classScore: done ? show(c.classScore) : null,
      areaScore: done ? show(c.areaScore) : null,
      total: done ? show(c.total) : null,
    });
  }
  const termScore = rounds.length
    ? ((await getTermResults(db, term.id)).classes.find((c) => c.classId === classId)?.termScore ?? null)
    : null;
  return {
    classId,
    display: cls.displayName,
    roomNumber: rooms.get(classId) ?? null,
    areaWord: termView(term).areaWord,
    rounds: out,
    termScore: show(termScore),
  };
}

// ───────────── areas (§6.4) ─────────────

export interface PublicArea {
  areaId: string;
  name: string;
  description: string | null;
  rounds: { roundNo: number; score: string | null }[];
  termScore: string | null;
  /** classes responsible for the area in the latest started round */
  classes: { classId: string; display: string; roomNumber: string | null }[];
}

/** GET /public/areas — buildings or zones of the term with per-round chips, term total and responsible classes. */
export async function listPublicAreas(db: Db, now: Date): Promise<{ term: PublicTerm | null; areas: PublicArea[] }> {
  const term = await places.findActiveTerm(db);
  if (!term) return { term: null, areas: [] };
  const rounds = (await termsRepo.listRounds(db, term.id)).filter((r) => r.status !== 'scheduled');
  const per: RoundResults[] = [];
  for (const r of rounds) per.push(await getRoundResults(db, r.id));
  const latest = rounds.at(-1) ?? null;
  const frozen = latest ? await roundsRepo.listRoundClassAreas(db, latest.id) : [];
  const classes = await places.listClasses(db);
  const rooms = await roomNumbers(db, latest?.id ?? null, now);
  const areas = (await places.listAreas(db)).filter((a) => a.type === term.areaType && a.isActive);
  return {
    term: termView(term),
    areas: areas.map((a) => {
      const scored = per.map((p) => p.areas.find((x) => x.areaId === a.id) ?? null);
      const valid = scored.filter((s): s is NonNullable<typeof s> => s !== null && s.max > 0);
      const max = valid.at(-1)?.max ?? 0;
      return {
        areaId: a.id,
        name: a.name,
        description: a.description,
        rounds: rounds.map((r, i) => ({ roundNo: r.roundNo, score: show(scored[i]?.score ?? null) })),
        termScore:
          max > 0
            ? show(
                termScoreByRound(
                  valid.map((s) => ({ total: s.score, max: s.max })),
                  max,
                ),
              )
            : null,
        classes: frozen
          .filter((f) => f.areaId === a.id)
          .map((f) => classes.find((c) => c.id === f.classId))
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
          .map((c) => ({ classId: c.id, display: c.displayName, roomNumber: rooms.get(c.id) ?? null })),
      };
    }),
  };
}

// ───────────── orders and guide (§6.1 tiles) ─────────────

export interface PublicOrder {
  id: string;
  title: string;
  url: string;
}

/** GET /public/orders — appointment orders of the active term (PDF files). */
export async function listPublicOrders(db: Db): Promise<PublicOrder[]> {
  const term = await places.findActiveTerm(db);
  if (!term) return [];
  return (await contentRepo.listOrders(db, term.id)).map((o) => ({
    id: o.id,
    title: o.title,
    url: `/api/v1/orders/${o.id}`,
  }));
}

export interface PublicGuidePage {
  slug: string;
  title: string;
  bodyMd: string;
}

export async function listPublicGuide(db: Db): Promise<Omit<PublicGuidePage, 'bodyMd'>[]> {
  return (await contentRepo.listGuidePages(db, ['public'])).map((g) => ({ slug: g.slug, title: g.title }));
}

export async function getPublicGuidePage(db: Db, slug: string): Promise<PublicGuidePage | null> {
  const g = await contentRepo.findGuidePage(db, slug);
  return g && g.audience === 'public' ? { slug: g.slug, title: g.title, bodyMd: g.bodyMd } : null;
}
