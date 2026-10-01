/**
 * ปพ.5 integration (05-api §3.3, FR-I4, T27): API keys, the network allow-list, and the per-class / per-student
 * term results the school's ปพ.5 program pulls. Only **finalized** rounds are included; `termComplete` tells the
 * program when final grades may be imported. Students appear by code only — never by name.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import type { Cell } from '../../lib/csv/write.ts';
import { ipAllowed, parseCidrs } from '../../lib/net/cidr.ts';
import { termScoreByRound } from '../../lib/scoring/index.ts';
import { parseScore, toDisplay, type Th } from '../../lib/scoring/decimal.ts';
import { AppError, notFound, parseInput } from '../errors.ts';
import { assertCan, assertStepUp, type SessionUser } from '../policies/index.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/pp5.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { getRoundResults, type RoundResults } from './result.service.ts';

const two = (th: Th | null) => (th === null ? null : toDisplay(th));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ───────────── API keys ─────────────

export const apiKeyInput = z.object({ name: z.string().trim().min(1, 'กรุณาตั้งชื่อคีย์').max(80) });

/** The plain key is returned once; only its sha256 is stored. */
export async function createApiKey(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof apiKeyInput>,
  meta: ClientMeta,
  now: Date,
): Promise<{ id: string; key: string }> {
  assertCan(actor, 'apikey.manage');
  assertStepUp(actor, now);
  const { name } = parseInput(apiKeyInput, raw);
  const key = `zw_pp5_${randomBytes(24).toString('base64url')}`;
  const id = newId();
  await withTransaction(db, async (tx) => {
    await repo.insertApiKey(tx, { id, name, keyHash: sha256(key), createdAt: now });
    await writeAudit(
      tx,
      { actorId: actor.id, action: 'apikey.create', entity: 'api_key', entityId: id, after: { name }, ip: meta.ip },
      now,
    );
  });
  return { id, key };
}

export async function revokeApiKey(db: Db, actor: SessionUser, id: string, meta: ClientMeta, now: Date) {
  assertCan(actor, 'apikey.manage');
  await withTransaction(db, async (tx) => {
    const row = await repo.revokeApiKey(tx, id, now);
    if (!row) throw notFound();
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'apikey.revoke',
        entity: 'api_key',
        entityId: id,
        before: { name: row.name },
        ip: meta.ip,
      },
      now,
    );
  });
}

export async function listApiKeys(db: Db, actor: SessionUser) {
  assertCan(actor, 'staff.read');
  return (await repo.listApiKeys(db)).map(({ keyHash: _hash, ...k }) => k);
}

export const pp5Cidrs = () =>
  parseCidrs(process.env.PP5_ALLOWED_CIDRS ?? '127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16');

/**
 * Every /pp5 request: the caller's address must be in `PP5_ALLOWED_CIDRS` (403) and the bearer key valid and not
 * revoked (401). Behind Cloudflare Tunnel `CF-Connecting-IP` is the public address, so internet callers fail the
 * network check even with a stolen key.
 */
export async function authorizePp5(
  db: Db,
  req: { ip: string; authorization: string | null },
  now: Date,
  cidrs = pp5Cidrs(),
) {
  if (!ipAllowed(req.ip, cidrs)) throw new AppError('FORBIDDEN');
  const m = /^Bearer\s+(\S+)$/i.exec(req.authorization ?? '');
  const key = m ? await repo.findActiveKeyByHash(db, sha256(m[1]!)) : null;
  if (!key) throw new AppError('UNAUTHENTICATED');
  await repo.touchApiKey(db, key.id, now);
  return key;
}

// ───────────── results ─────────────

/** The class string as the student API writes it, so the ปพ.5 program can join on it (§3.3 `sourceClassKey`). */
export function sourceClassKey(c: { track: string; gradeLabel: string; roomNo: number; name: string }) {
  return c.track === 'general' ? `${c.gradeLabel}/${c.roomNo} ${c.name}` : c.name;
}

async function finalized(db: Db, termId: string) {
  const term = await places.findTerm(db, termId);
  if (!term) throw notFound();
  const rounds = await termsRepo.listRounds(db, term.id);
  const done = rounds.filter((r) => r.status === 'finalized');
  const results: { roundNo: number; roundId: string; r: RoundResults }[] = [];
  for (const round of done)
    results.push({ roundNo: round.roundNo, roundId: round.id, r: await getRoundResults(db, round.id) });
  return { term, rounds, done, results };
}

export interface Pp5Term {
  termId: string;
  academicYear: number;
  termNo: number;
  finalMax: string;
  roundsFinalized: number[];
  roundsTotal: number;
}

/** GET /pp5/terms */
export async function listPp5Terms(db: Db): Promise<Pp5Term[]> {
  const out: Pp5Term[] = [];
  for (const t of await termsRepo.listTerms(db)) {
    if (t.purgedAt) continue;
    const rounds = await termsRepo.listRounds(db, t.id);
    out.push({
      termId: t.id,
      academicYear: t.academicYear,
      termNo: t.termNo,
      finalMax: toDisplay(parseScore(t.finalMax)),
      roundsFinalized: rounds.filter((r) => r.status === 'finalized').map((r) => r.roundNo),
      roundsTotal: rounds.length,
    });
  }
  return out;
}

export interface Pp5Classes {
  academicYear: number;
  termNo: number;
  finalMax: string;
  roundsFinalized: number[];
  roundsTotal: number;
  termComplete: boolean;
  generatedAt: string;
  classes: {
    classId: string;
    track: string;
    grade: string;
    name: string;
    display: string;
    sourceClassKey: string;
    rounds: { roundNo: number; classScore: string | null; areaScore: string | null; total: string | null }[];
    termScore: string | null;
  }[];
}

const bangkokIso = (d: Date) => {
  const local = new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19);
  return `${local}+07:00`;
};

/** GET /pp5/terms/{termId}/classes — per class (group mode), finalized rounds only. */
export async function getPp5Classes(db: Db, termId: string, now: Date): Promise<Pp5Classes> {
  const { term, rounds, done, results } = await finalized(db, termId);
  const selected = new Set(await places.listTermClassIds(db, term.id));
  const finalMax = parseScore(term.finalMax);
  const classes = (await places.listClasses(db)).filter((c) => selected.has(c.id));
  return {
    academicYear: term.academicYear,
    termNo: term.termNo,
    finalMax: toDisplay(finalMax),
    roundsFinalized: done.map((r) => r.roundNo),
    roundsTotal: rounds.length,
    termComplete: rounds.length > 0 && done.length === rounds.length,
    generatedAt: bangkokIso(now),
    classes: classes.map((c) => {
      const per = results.map(({ roundNo, r }) => ({
        roundNo,
        row: r.classes.find((x) => x.classId === c.id) ?? null,
      }));
      const scored = per.filter((p) => p.row && p.row.max > 0).map((p) => ({ total: p.row!.total, max: p.row!.max }));
      return {
        classId: c.id,
        track: c.track,
        grade: c.gradeLabel,
        name: c.name,
        display: c.displayName,
        sourceClassKey: sourceClassKey(c),
        rounds: per.map(({ roundNo, row }) => ({
          roundNo,
          classScore: row && row.total !== null ? two(row.classScore) : null,
          areaScore: row && row.total !== null ? two(row.areaScore) : null,
          total: row ? two(row.total) : null,
        })),
        termScore: scored.length ? two(termScoreByRound(scored, finalMax)) : null,
      };
    }),
  };
}

export interface Pp5Students {
  academicYear: number;
  termNo: number;
  finalMax: string;
  roundsFinalized: number[];
  termComplete: boolean;
  generatedAt: string;
  students: {
    studentCode: string;
    homeClassKey: string | null;
    rounds: { roundNo: number; classKey: string; total: string }[];
    termScore: string | null;
  }[];
}

/** GET /pp5/terms/{termId}/students — per student code; 404 NOT_AVAILABLE when no finalized round has rosters. */
export async function getPp5Students(db: Db, termId: string, now: Date): Promise<Pp5Students> {
  const { term, rounds, done, results } = await finalized(db, termId);
  const rows = await repo.listStudentResults(
    db,
    done.map((r) => r.id),
  );
  if (rows.length === 0) throw new AppError('NOT_AVAILABLE');
  const classes = new Map((await places.listClasses(db)).map((c) => [c.id, c]));
  const keyOf = (id: string | null) => {
    const c = id ? classes.get(id) : undefined;
    return c ? sourceClassKey(c) : null;
  };
  const finalMax = parseScore(term.finalMax);
  const byCode = new Map<string, typeof rows>();
  for (const r of rows) byCode.set(r.studentCode, [...(byCode.get(r.studentCode) ?? []), r]);
  const roundNo = new Map(done.map((r) => [r.id, r.roundNo]));
  const maxOf = (roundId: string, classId: string) =>
    results.find((x) => x.roundId === roundId)?.r.classes.find((c) => c.classId === classId)?.max ?? 0;
  return {
    academicYear: term.academicYear,
    termNo: term.termNo,
    finalMax: toDisplay(finalMax),
    roundsFinalized: done.map((r) => r.roundNo),
    termComplete: rounds.length > 0 && done.length === rounds.length,
    generatedAt: bangkokIso(now),
    students: [...byCode.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([studentCode, list]) => {
        const sorted = [...list].sort((a, b) => roundNo.get(a.roundId)! - roundNo.get(b.roundId)!);
        const scored = sorted
          .map((s) => ({ total: parseScore(s.total), max: maxOf(s.roundId, s.classId) }))
          .filter((s) => s.max > 0);
        return {
          studentCode,
          homeClassKey: keyOf(list[0]!.homeClassId),
          rounds: sorted.map((s) => ({
            roundNo: roundNo.get(s.roundId)!,
            classKey: keyOf(s.classId) ?? '',
            total: toDisplay(parseScore(s.total)),
          })),
          termScore: scored.length ? two(termScoreByRound(scored, finalMax)) : null,
        };
      }),
  };
}

// ───────────── CSV (the default format for the ปพ.5 program) ─────────────

/**
 * Flat, fixed columns so the ปพ.5 program can import without knowing how many rounds a term has: one row per
 * class (or student) per finalized round; the term score repeats on each row. A class without any finalized
 * round still gets one row with empty round columns.
 */
export function pp5TermsCsv(terms: Pp5Term[]): Cell[][] {
  return [
    ['term_id', 'academic_year', 'term_no', 'final_max', 'rounds_finalized', 'rounds_total'],
    ...terms.map((t) => [t.termId, t.academicYear, t.termNo, t.finalMax, t.roundsFinalized.join('|'), t.roundsTotal]),
  ];
}

export function pp5ClassesCsv(d: Pp5Classes): Cell[][] {
  const head = [d.academicYear, d.termNo, d.termComplete, d.finalMax];
  return [
    [
      'academic_year',
      'term_no',
      'term_complete',
      'final_max',
      'class_id',
      'track',
      'grade',
      'class_name',
      'display',
      'source_class_key',
      'round_no',
      'class_score',
      'area_score',
      'round_total',
      'term_score',
    ],
    ...d.classes.flatMap((c) => {
      const cls = [c.classId, c.track, c.grade, c.name, c.display, c.sourceClassKey];
      const rounds = c.rounds.length ? c.rounds : [null];
      return rounds.map((r) => [...head, ...cls, r?.roundNo, r?.classScore, r?.areaScore, r?.total, c.termScore]);
    }),
  ];
}

export function pp5StudentsCsv(d: Pp5Students): Cell[][] {
  return [
    [
      'academic_year',
      'term_no',
      'term_complete',
      'student_code',
      'home_class_key',
      'round_no',
      'class_key',
      'round_total',
      'term_score',
    ],
    ...d.students.flatMap((s) =>
      s.rounds.map((r) => [
        d.academicYear,
        d.termNo,
        d.termComplete,
        s.studentCode,
        s.homeClassKey,
        r.roundNo,
        r.classKey,
        r.total,
        s.termScore,
      ]),
    ),
  ];
}
