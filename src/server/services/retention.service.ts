/**
 * Retention (04-business-rules §10, 12-security §3, T28):
 * - `retention.warn` (daily 08:00): 30 days before a closed term's `purge_after`, super admins and admins get
 *   `retention_warning` with a link to the archive downloads (BR-D2). Sent once per term (app_settings marker).
 * - `retention.run` (daily 03:00): terms past `purge_after` lose everything under them in one transaction, the
 *   `terms` row stays with `purged_at`; then the files go (BR-D3). Students past `delete_after` in no remaining
 *   snapshot are deleted (BR-D4); audit rows not tied to a term after one year; expired sessions.
 * Places, classes, users and settings are never touched.
 */
import { readFile } from 'node:fs/promises';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString, formatTermLabel, formatThaiDate } from '../../lib/dates/index.ts';
import { AppError, notFound } from '../errors.ts';
import { THUMB_WIDTHS } from '../evidence/paths.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/retention.repository.ts';
import * as systemRepo from '../repositories/system.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { dataDir, removeDataFile, resolveData } from '../storage.ts';
import { withTransaction } from '../transaction.ts';
import { zipStream, type ZipEntry } from '../zip.ts';
import { writeAudit } from './audit.service.ts';
import { readLastDisk } from './disk.service.ts';
import { send } from './notify.service.ts';

export const RETENTION_RUN_QUEUE = 'retention.run';
export const RETENTION_WARN_QUEUE = 'retention.warn';
export const RETENTION_DAYS = 365;
export const WARN_DAYS = 30;
const DAY = 86_400_000;

/** BR-D1: the Bangkok calendar date one year after closing. */
export function purgeAfterFor(closedAt: Date): string {
  return bangkokDateString(new Date(closedAt.getTime() + RETENTION_DAYS * DAY));
}

/** A `YYYY-MM-DD` date as the instant it starts in Bangkok. */
const bangkokMidnight = (date: string) => new Date(`${date}T00:00:00+07:00`);

/** Whole days from `today` to `date` (both Bangkok calendar dates). */
export function daysUntil(date: string, today: string): number {
  return Math.round((bangkokMidnight(date).getTime() - bangkokMidnight(today).getTime()) / DAY);
}

/** Written by deploy/backup.sh after a successful off-site copy (14-deployment §2 step 8). */
export const BACKUP_KEY = 'backup.last';

const warnedKey = (termId: string) => `retention.warned.${termId}`;

// ───────────── BR-D2 warning ─────────────

export async function warnRetention(db: Db, now: Date): Promise<{ warned: string[] }> {
  const today = bangkokDateString(now);
  const warned: string[] = [];
  for (const term of await repo.listClosedTerms(db)) {
    if (term.purgedAt || !term.purgeAfter) continue;
    const days = daysUntil(term.purgeAfter, today);
    if (days > WARN_DAYS || days < 0) continue;
    if ((await systemRepo.readSetting(db, warnedKey(term.id))) !== null) continue;
    await withTransaction(db, async (tx) => {
      const label = formatTermLabel(term.termNo, term.academicYear).replace('ภาคเรียนที่ ', '');
      await send(
        tx,
        {
          userIds: await usersRepo.listActiveUserIdsByRole(tx, ['super_admin', 'admin']),
          type: 'retention_warning',
          title: `ข้อมูลภาคเรียน ${label} จะถูกลบใน ${days} วัน`,
          body: `ดาวน์โหลดข้อมูลเก็บถาวรได้ก่อนวันที่ ${formatThaiDate(bangkokMidnight(term.purgeAfter!))}`,
          link: '/admin/settings/privacy',
        },
        now,
      );
      await systemRepo.writeSetting(tx, warnedKey(term.id), { at: now.toISOString() }, now);
      await writeAudit(
        tx,
        { actorId: null, action: 'retention.warn', entity: 'retention', entityId: term.id, after: { days } },
        now,
      );
    });
    warned.push(term.id);
  }
  return { warned };
}

// ───────────── BR-D3 / BR-D4 purge ─────────────

export interface RetentionOutcome {
  purgedTerms: { termId: string; evaluations: number; files: number; auditRows: number }[];
  students: number;
  oldAuditRows: number;
  sessions: number;
}

export async function runRetention(db: Db, now: Date, opts: { root?: string } = {}): Promise<RetentionOutcome> {
  const today = bangkokDateString(now);
  const root = opts.root ?? dataDir();
  const out: RetentionOutcome = { purgedTerms: [], students: 0, oldAuditRows: 0, sessions: 0 };

  for (const term of await repo.listTermsToPurge(db, today)) {
    const contents = await withTransaction(db, async (tx) => {
      const c = await repo.termContents(tx, term.id);
      const auditRows = await repo.deleteTermAudit(tx, term.id, c);
      await repo.deleteTermData(tx, term.id, c);
      await termsRepo.updateTerm(tx, term.id, { purgedAt: now });
      await systemRepo.deleteSetting(tx, warnedKey(term.id));
      // Not a term-entity row, so the record of the purge itself survives it.
      await writeAudit(
        tx,
        {
          actorId: null,
          action: 'retention.purge',
          entity: 'retention',
          entityId: term.id,
          after: {
            academicYear: term.academicYear,
            termNo: term.termNo,
            rounds: c.roundIds.length,
            evaluations: c.evalIds.length,
            evidence: c.evidence.length,
            pdfs: c.pdfs.length,
            requests: c.reqIds.length,
            auditRows,
          },
        },
        now,
      );
      return { ...c, auditRows };
    });
    // Files after the commit: a crash here leaves unreferenced files, never rows pointing at missing files.
    let files = 0;
    for (const e of contents.evidence) {
      if (await repo.evidenceShaInUse(db, e.sha256)) continue;
      await removeDataFile(e.filePath, root);
      for (const w of THUMB_WIDTHS) await removeDataFile(e.filePath.replace(/\.webp$/, `_w${w}.webp`), root);
      files++;
    }
    for (const f of [...contents.pdfs, ...contents.orders]) {
      await removeDataFile(f.filePath, root);
      files++;
    }
    out.purgedTerms.push({
      termId: term.id,
      evaluations: contents.evalIds.length,
      files,
      auditRows: contents.auditRows,
    });
  }

  await withTransaction(db, async (tx) => {
    out.students = await repo.deleteExpiredStudents(tx, today);
    out.oldAuditRows = await repo.deleteOldAudit(tx, new Date(now.getTime() - RETENTION_DAYS * DAY));
    out.sessions = await repo.deleteExpiredSessions(tx, now);
    if (out.students > 0 || out.oldAuditRows > 0)
      await writeAudit(
        tx,
        {
          actorId: null,
          action: 'retention.cleanup',
          entity: 'retention',
          entityId: today,
          after: { students: out.students, auditRows: out.oldAuditRows },
        },
        now,
      );
  });
  return out;
}

// ───────────── privacy page ─────────────

export interface RetentionTermView {
  id: string;
  academicYear: number;
  termNo: number;
  status: 'draft' | 'active' | 'closed';
  closedAt: Date | null;
  purgeAfter: string | null;
  purgedAt: Date | null;
  daysLeft: number | null;
}

/** 08-ux-ui §6 "ข้อมูลและความเป็นส่วนตัว": every term with its retention state, newest first. */
export async function getRetentionOverview(db: Db, actor: SessionUser, now: Date) {
  assertCan(actor, 'staff.read');
  const today = bangkokDateString(now);
  const terms: RetentionTermView[] = (await termsRepo.listTerms(db)).map((t) => ({
    id: t.id,
    academicYear: t.academicYear,
    termNo: t.termNo,
    status: t.status,
    closedAt: t.closedAt,
    purgeAfter: t.purgeAfter,
    purgedAt: t.purgedAt,
    daysLeft: t.purgeAfter && !t.purgedAt ? daysUntil(t.purgeAfter, today) : null,
  }));
  const backup = (await systemRepo.readSetting(db, BACKUP_KEY)) as { at?: string } | null;
  return {
    terms,
    retentionDays: RETENTION_DAYS,
    warnDays: WARN_DAYS,
    lastBackupAt: backup?.at ? new Date(backup.at) : null,
    disk: await readLastDisk(db),
  };
}

// ───────────── archive (BR-D2) ─────────────

/**
 * "ดาวน์โหลดข้อมูลเก็บถาวร": every PDF of the term (all versions) as one ZIP, foldered by round. Files missing on
 * disk are listed in a text file inside the archive instead of failing the download. Staff only.
 */
export async function termPdfArchive(db: Db, actor: SessionUser, termId: string, opts: { root?: string } = {}) {
  assertCan(actor, 'staff.read');
  const term = await termsRepo.findTerm(db, termId);
  if (!term) throw notFound();
  if (term.purgedAt) throw new AppError('NOT_AVAILABLE', { message: 'ข้อมูลภาคเรียนนี้ถูกลบตามกำหนดแล้ว' });
  const pdfs = await repo.listTermPdfs(db, termId);
  const root = opts.root ?? dataDir();
  async function* entries(): AsyncGenerator<ZipEntry> {
    const missing: string[] = [];
    for (const p of pdfs) {
      const name = `รอบ${p.roundNo}/${p.docNumber}_v${p.version}${p.isDraft ? '_ฉบับร่าง' : ''}.pdf`;
      try {
        yield { name, data: await readFile(resolveData(p.filePath, root)) };
      } catch {
        missing.push(name);
      }
    }
    if (missing.length)
      yield { name: 'ไฟล์ที่หาไม่พบ.txt', data: new TextEncoder().encode(`${missing.join('\r\n')}\r\n`) };
  }
  return {
    filename: `pdf-${term.academicYear}-${term.termNo}.zip`,
    count: pdfs.length,
    stream: zipStream(entries()),
  };
}
