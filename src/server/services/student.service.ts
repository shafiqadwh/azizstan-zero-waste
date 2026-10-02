/**
 * Student sync (BR-Y, 10-integrations §1, T25) and the `/admin/settings/students` read/write models.
 * This is the only module that reads `students.full_name` (to detect renames); nothing it returns or logs carries
 * a name — runs, changes and the review list use student codes and class strings only.
 *
 * The CSV lives in memory only: it is fetched, parsed and dropped; no temp file, no log of the text or the URL
 * (the token is a query parameter).
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import {
  classDraftFrom,
  classLookupKey,
  normalizeClassString,
  parseGeneralClass,
  type ClassDraft,
} from '../../lib/scoring/classKey.ts';
import { parseStudentCsv, type StudentRow } from '../../lib/students/csv.ts';
import { AppError, notFound, parseInput, validation } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as evalRepo from '../repositories/evaluations.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/students.repository.ts';
import * as systemRepo from '../repositories/system.repository.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { send } from './notify.service.ts';

export const STUDENT_SYNC_QUEUE = 'students.sync';
export type SyncSource = 'general' | 'vocational';
export const SYNC_SOURCES: SyncSource[] = ['general', 'vocational'];

/** Fetches one source's CSV text. Injected in tests; `httpFetcher` in production. */
export type StudentFetcher = (source: SyncSource, params: { academicYear: number; termNo: number }) => Promise<string>;

export const STUDENT_MSG = {
  noTerm: 'ยังไม่มีภาคเรียนที่ใช้งาน — สร้างและเปิดใช้ภาคเรียนที่ ตั้งค่า → ภาคเรียน ก่อน แล้วกด sync ใหม่',
  busy: 'กำลัง sync อยู่แล้ว',
  prefix: 'กรุณาระบุคำขึ้นต้น (ไม่เกิน 60 ตัวอักษร)',
  prefixTaken: 'มีคำขึ้นต้นนี้แล้ว',
} as const;

// ───────────── fetching ─────────────

/** BR-Y step 1: GET {base}/Export or /ExportVoc, 60 s timeout, 2 retries. Errors never include the URL. */
export function httpFetcher(
  base = process.env.STUDENT_API_BASE ?? '',
  token = process.env.STUDENT_API_TOKEN ?? '',
): StudentFetcher {
  return async (source, { academicYear, termNo }) => {
    if (!base || !token) throw new Error('student API is not configured');
    const url = new URL(`${base.replace(/\/$/, '')}/${source === 'general' ? 'Export' : 'ExportVoc'}`);
    url.searchParams.set('token', token);
    url.searchParams.set('academic_year', String(academicYear));
    url.searchParams.set('term_id', String(termNo));
    let last = 'unknown error';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: 'no-store' });
        if (!res.ok) {
          last = `HTTP ${res.status}`;
          continue;
        }
        return new TextDecoder('utf-8').decode(await res.arrayBuffer());
      } catch (err) {
        last = (err as Error).name === 'TimeoutError' ? 'timeout' : 'network error';
      }
    }
    throw new Error(`${source === 'general' ? 'Export' : 'ExportVoc'}: ${last}`);
  };
}

// ───────────── class resolution (BR-Y step 4, §9.2) ─────────────

interface Resolver {
  resolve(raw: string): string | null;
  skipped(raw: string): boolean;
  className(id: string | null): string | null;
}

async function resolver(db: Db): Promise<Resolver> {
  const aliases = new Map((await repo.listAliasMap(db)).map((a) => [a.alias, a.classId]));
  const list = await repo.listClassesForSync(db);
  const byDisplay = new Map(list.map((c) => [normalizeClassString(c.displayName).toLowerCase(), c.id]));
  const byGeneral = new Map(list.map((c) => [`${c.gradeLabel}|${c.name}`.toLowerCase(), c.id]));
  const names = new Map(list.map((c) => [c.id, c.displayName]));
  const prefixes = (await repo.listSkipRules(db)).map((r) => r.prefix.normalize('NFC').toLowerCase());
  return {
    resolve(raw) {
      const key = classLookupKey(raw);
      if (!key) return null;
      const g = parseGeneralClass(raw);
      return (
        aliases.get(key) ??
        (g ? byGeneral.get(`${g.gradeLabel}|${g.name}`.toLowerCase()) : undefined) ??
        byDisplay.get(normalizeClassString(raw).toLowerCase()) ??
        null
      );
    },
    skipped(raw) {
      const s = normalizeClassString(raw).toLowerCase();
      return prefixes.some((p) => s.startsWith(p));
    },
    className: (id) => (id ? (names.get(id) ?? null) : null),
  };
}

// ───────────── the sync (BR-Y 9.1) ─────────────

interface Counts {
  rows: number;
  added: number;
  moved: number;
  renamed: number;
  inactive: number;
  review: number;
  malformed: number;
  skipped: number;
  /** classes the sync created because the register had no match (BR-Y step 4b) */
  created: number;
}
const zero = (): Counts => ({
  rows: 0,
  added: 0,
  moved: 0,
  renamed: 0,
  inactive: 0,
  review: 0,
  malformed: 0,
  skipped: 0,
  created: 0,
});

export type SyncChange =
  | { code: string; change: 'added' | 'moved'; from?: string | null; to: string | null }
  | { code: string; change: 'renamed' | 'inactive' }
  | { code: string; change: 'review'; reason: string };

export interface SyncOutcome {
  status: 'success' | 'aborted' | 'failed';
  counts: Record<SyncSource, Counts>;
  changes: SyncChange[];
  error: string | null;
  malformed: string[];
}

interface Incoming {
  row: StudentRow;
  source: SyncSource;
  generalClassId: string | null;
  religiousClassId: string | null;
  review: string | null;
}

const ratio = () => {
  const r = Number(process.env.SYNC_ABORT_RATIO ?? '0.10');
  return Number.isFinite(r) && r > 0 ? r : 0.1;
};
const retentionDays = () => {
  const d = Number(process.env.STUDENT_RETENTION_DAYS ?? '365');
  return Number.isFinite(d) && d > 0 ? d : 365;
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function notifyProblem(db: Db, kind: 'failed' | 'aborted', reason: string, now: Date) {
  await send(
    db,
    {
      userIds: await evalRepo.listAdminIds(db),
      type: 'sync_problem',
      title: kind === 'failed' ? 'Sync รายชื่อล้มเหลว' : 'Sync รายชื่อหยุดอัตโนมัติ',
      body: reason,
      link: '/admin/settings/students',
    },
    now,
  );
}

async function recordRuns(db: Db, out: SyncOutcome, startedAt: Date, finishedAt: Date, triggeredBy: string | null) {
  for (const source of SYNC_SOURCES) {
    await repo.insertSyncRun(db, {
      id: newId(),
      source,
      startedAt,
      finishedAt,
      status: out.status,
      counts: { ...out.counts[source] },
      changes: source === 'general' ? out.changes : [],
      error: out.error,
      triggeredBy,
    });
  }
}

/**
 * Job `students.sync` (BR-Y): fetch both sources, parse, skip, resolve, diff, abort guard, apply in one
 * transaction, record the runs. Open rounds' roster snapshots are never touched (FR-R3).
 */
export async function runStudentSync(
  db: Db,
  opts: { fetcher: StudentFetcher; now: Date; triggeredBy?: string | null },
): Promise<SyncOutcome> {
  const { now } = opts;
  const startedAt = now;
  const counts = { general: zero(), vocational: zero() };
  const fail = async (
    status: 'failed' | 'aborted',
    error: string,
    changes: SyncChange[] = [],
    malformed: string[] = [],
  ) => {
    const out: SyncOutcome = { status, counts, changes, error, malformed };
    await recordRuns(db, out, startedAt, new Date(), opts.triggeredBy ?? null);
    await notifyProblem(db, status, error, now);
    return out;
  };

  const term = await places.findActiveTerm(db);
  if (!term) return fail('failed', STUDENT_MSG.noTerm);

  // 1–3: fetch and parse each source; the text goes out of scope right after parsing
  const parsed: { source: SyncSource; rows: StudentRow[] }[] = [];
  const malformed: string[] = [];
  for (const source of SYNC_SOURCES) {
    let rows: StudentRow[];
    try {
      const p = parseStudentCsv(await opts.fetcher(source, { academicYear: term.academicYear, termNo: term.termNo }));
      rows = p.students;
      counts[source].rows = p.rows;
      counts[source].malformed = p.malformed.length;
      malformed.push(...p.malformed);
    } catch (err) {
      return fail('failed', String((err as Error).message ?? err).slice(0, 200));
    }
    parsed.push({ source, rows });
  }

  // 4 / 4a: skip rules, then class resolution (religious only when the general cell is empty)
  const r = await resolver(db);
  // 4b: a general or vocational class string the register lacks ("ม.1/1 Amanah", "ปวช.2/1") becomes a new class,
  // created in the same transaction as the students; anything else still goes to review
  const planned = new Map<string, ClassDraft & { id: string }>();
  const plan = (raw: string, source: SyncSource): string | null => {
    const draft = classDraftFrom(raw);
    if (!draft) return null;
    const existing = r.resolve(draft.displayName);
    if (existing) return existing;
    const key = `${draft.track}|${draft.gradeCode}|${draft.name}`.toLowerCase();
    let p = planned.get(key);
    if (!p) {
      p = { ...draft, id: newId() };
      planned.set(key, p);
      counts[source].created++;
    }
    return p.id;
  };
  const className = (id: string | null) =>
    r.className(id) ?? [...planned.values()].find((p) => p.id === id)?.displayName ?? null;
  const incoming = new Map<string, Incoming>();
  const duplicates = new Set<string>();
  const skippedCodes = new Set<string>();
  for (const { source, rows } of parsed) {
    for (const row of rows) {
      const mustResolve = row.general || row.religious;
      if (mustResolve && r.skipped(mustResolve)) {
        counts[source].skipped++;
        skippedCodes.add(row.code);
        continue;
      }
      if (incoming.has(row.code)) duplicates.add(row.code);
      let review: string | null = null;
      let generalClassId: string | null = null;
      let religiousClassId: string | null = null;
      if (row.general) {
        generalClassId = r.resolve(row.general) ?? plan(row.general, source);
        if (!generalClassId) review = `unknown_class:${normalizeClassString(row.general)}`;
      } else if (row.religious) {
        religiousClassId = r.resolve(row.religious);
        if (!religiousClassId) review = `unknown_class:${normalizeClassString(row.religious)}`;
      } else review = 'no_class';
      incoming.set(row.code, { row, source, generalClassId, religiousClassId, review });
    }
  }
  for (const code of duplicates) incoming.get(code)!.review = 'duplicate_code';

  // 5: diff by student code
  const existing = await repo.listStudentsForSync(db);
  const byCode = new Map(existing.map((s) => [s.studentCode, s]));
  const changes: SyncChange[] = [];
  const inserts: Parameters<typeof repo.insertStudents>[1] = [];
  const updates: { id: string; patch: Parameters<typeof repo.updateStudent>[2] }[] = [];
  const deleteAfter = isoDate(new Date(now.getTime() + retentionDays() * 86_400_000));
  for (const [code, inc] of incoming) {
    const c = counts[inc.source];
    const home = inc.generalClassId ?? inc.religiousClassId;
    const status = inc.review ? ('review' as const) : ('active' as const);
    const cur = byCode.get(code);
    if (inc.review) {
      c.review++;
      if (cur?.status !== 'review' || cur.reviewReason !== inc.review)
        changes.push({ code, change: 'review', reason: inc.review });
    }
    if (!cur) {
      inserts.push({
        id: newId(),
        studentCode: code,
        fullName: inc.row.fullName,
        generalClassId: inc.generalClassId,
        religiousClassId: inc.religiousClassId,
        homeClassId: home,
        status,
        reviewReason: inc.review,
        firstSeenAt: now,
        lastSeenAt: now,
        deleteAfter,
      });
      if (!inc.review) {
        c.added++;
        changes.push({ code, change: 'added', to: className(home) });
      }
      continue;
    }
    const patch: Parameters<typeof repo.updateStudent>[2] = {
      status,
      reviewReason: inc.review,
      lastSeenAt: now,
      deleteAfter,
    };
    if (!inc.review && home !== cur.homeClassId) {
      Object.assign(patch, {
        generalClassId: inc.generalClassId,
        religiousClassId: inc.religiousClassId,
        homeClassId: home,
      });
      c.moved++;
      changes.push({ code, change: 'moved', from: className(cur.homeClassId), to: className(home) });
    }
    if (inc.row.fullName && inc.row.fullName !== cur.fullName) {
      patch.fullName = inc.row.fullName;
      c.renamed++;
      changes.push({ code, change: 'renamed' });
    }
    updates.push({ id: cur.id, patch });
  }
  const absent = existing.filter((s) => s.status !== 'inactive' && !incoming.has(s.studentCode));
  const guarded = absent.filter((s) => !skippedCodes.has(s.studentCode));

  // 6: abort guard (skipped students don't count)
  const active = existing.filter((s) => s.status === 'active').length;
  if (active > 0 && guarded.length > ratio() * active) {
    return fail(
      'aborted',
      `จะปิดสถานะนักเรียน ${guarded.length} จาก ${active} คน เกินเกณฑ์ ${Math.round(ratio() * 100)}% จึงหยุดไว้ก่อน`,
      [],
      malformed,
    );
  }
  for (const s of absent) changes.push({ code: s.studentCode, change: 'inactive' });
  counts.general.inactive = absent.length;

  // 7–8: apply in one transaction, then record the runs
  try {
    await withTransaction(db, async (tx) => {
      if (!(await repo.lockSync(tx))) throw new AppError('VALIDATION', { message: STUDENT_MSG.busy });
      for (const c of planned.values()) await places.insertClass(tx, { ...c, isActive: true });
      await repo.insertStudents(tx, inserts);
      for (const u of updates) await repo.updateStudent(tx, u.id, u.patch);
      await repo.setInactive(
        tx,
        absent.map((s) => s.id),
      );
      await writeAudit(
        tx,
        {
          actorId: opts.triggeredBy ?? null,
          action: 'students.sync',
          entity: 'sync',
          entityId: term.id,
          after: {
            general: counts.general,
            vocational: counts.vocational,
            classesCreated: [...planned.values()].map((c) => c.displayName),
          },
        },
        now,
      );
      if (planned.size > 0) {
        const names = [...planned.values()].map((c) => c.displayName).sort((a, b) => a.localeCompare(b, 'th'));
        await send(
          tx,
          {
            userIds: await evalRepo.listAdminIds(tx),
            type: 'classes_created',
            title: `sync สร้างห้องเรียนใหม่ ${names.length} ห้อง`,
            body: `${names.slice(0, 12).join(', ')}${names.length > 12 ? ` และอีก ${names.length - 12} ห้อง` : ''} · ตรวจชื่อและเลือกห้องที่ร่วมประเมินภาคนี้`,
            link: '/admin/settings/classes',
          },
          now,
        );
      }
    });
  } catch (err) {
    return fail('failed', err instanceof AppError ? err.message : 'apply failed');
  }
  const out: SyncOutcome = { status: 'success', counts, changes, error: null, malformed };
  await recordRuns(db, out, startedAt, new Date(), opts.triggeredBy ?? null);
  return out;
}

// ───────────── manual run request (the worker picks it up) ─────────────

export const SYNC_REQUEST_KEY = 'students.syncRequest';

/** "sync ตอนนี้": the app records the request; the worker sweep (every minute) runs it. */
export async function requestStudentSync(db: Db, actor: SessionUser, meta: ClientMeta, now: Date) {
  assertCan(actor, 'student.sync');
  await systemRepo.writeSetting(db, SYNC_REQUEST_KEY, { at: now.toISOString(), by: actor.id }, now, actor.id);
  await writeAudit(
    db,
    { actorId: actor.id, action: 'students.sync_request', entity: 'sync', entityId: 'students', ip: meta.ip },
    now,
  );
}

/** Worker sweep: take (and clear) a pending manual request. */
export async function takeSyncRequest(db: Db): Promise<{ by: string | null } | null> {
  const req = (await systemRepo.readSetting(db, SYNC_REQUEST_KEY)) as { by?: string } | null;
  if (!req) return null;
  await systemRepo.deleteSetting(db, SYNC_REQUEST_KEY);
  return { by: req.by ?? null };
}

export async function pendingSyncRequest(db: Db): Promise<boolean> {
  return (await systemRepo.readSetting(db, SYNC_REQUEST_KEY)) !== null;
}

// ───────────── /admin/settings/students ─────────────

export interface StudentsOverview {
  runs: {
    id: string;
    source: SyncSource;
    startedAt: Date;
    finishedAt: Date | null;
    status: string | null;
    counts: Record<string, number>;
    error: string | null;
    manual: boolean;
  }[];
  review: { id: string; code: string; reason: string | null; classString: string | null }[];
  skipRules: { id: string; prefix: string; note: string | null }[];
  classes: { id: string; display: string }[];
  activeCount: number;
}

/** §6.15: runs, review list (codes and class strings only), skip rules. No names anywhere. */
export async function getStudentsOverview(db: Db, actor: SessionUser): Promise<StudentsOverview> {
  assertCan(actor, 'staff.read');
  const [runs, review, rules, classes, activeCount] = await Promise.all([
    repo.listSyncRuns(db),
    repo.listReviewStudents(db),
    repo.listSkipRules(db),
    repo.listClassesForSync(db),
    repo.countActiveStudents(db),
  ]);
  return {
    runs: runs.map((r) => ({
      id: r.id,
      source: r.source,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      status: r.status,
      counts: r.counts ?? {},
      error: r.error,
      manual: r.triggeredBy !== null,
    })),
    review: review.map((s) => ({
      id: s.id,
      code: s.studentCode,
      reason: s.reviewReason,
      classString: s.reviewReason?.startsWith('unknown_class:') ? s.reviewReason.slice('unknown_class:'.length) : null,
    })),
    skipRules: rules.map((r) => ({ id: r.id, prefix: r.prefix, note: r.note })),
    classes: classes
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, display: c.displayName }))
      .sort((a, b) => a.display.localeCompare(b.display, 'th', { numeric: true })),
    activeCount,
  };
}

export const skipRuleInput = z.object({
  prefix: z.string().min(1, STUDENT_MSG.prefix).max(60, STUDENT_MSG.prefix),
  note: z.string().trim().max(200).optional(),
});

/** Card "ชั้นที่ไม่นำเข้า" (BR-Y step 4a). The prefix keeps a trailing space ("1M ") on purpose. */
export async function addSkipRule(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof skipRuleInput>,
  meta: ClientMeta,
  now: Date,
) {
  assertCan(actor, 'student.sync');
  const input = parseInput(skipRuleInput, raw);
  const prefix = input.prefix.normalize('NFC').replace(/^\s+/, '').replace(/\s+/g, ' ');
  if (!prefix.trim()) throw validation('prefix', STUDENT_MSG.prefix);
  return withTransaction(db, async (tx) => {
    const rules = await repo.listSkipRules(tx);
    if (rules.some((r) => r.prefix.toLowerCase() === prefix.toLowerCase()))
      throw validation('prefix', STUDENT_MSG.prefixTaken);
    const id = newId();
    await repo.insertSkipRule(tx, { id, prefix, note: input.note || null });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'skip_rule.add',
        entity: 'class_skip_rule',
        entityId: id,
        after: { prefix },
        ip: meta.ip,
      },
      now,
    );
    return id;
  });
}

export async function removeSkipRule(db: Db, actor: SessionUser, id: string, meta: ClientMeta, now: Date) {
  assertCan(actor, 'student.sync');
  await withTransaction(db, async (tx) => {
    const removed = await repo.deleteSkipRule(tx, id);
    if (!removed) throw notFound();
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'skip_rule.remove',
        entity: 'class_skip_rule',
        entityId: id,
        before: { prefix: removed.prefix },
        ip: meta.ip,
      },
      now,
    );
  });
}
