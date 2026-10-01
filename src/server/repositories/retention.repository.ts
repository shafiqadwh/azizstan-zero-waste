import { and, eq, inArray, isNotNull, isNull, lt, notExists, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  appointmentOrders,
  auditLogs,
  duties,
  evaluations,
  evidence,
  pdfDocuments,
  requests,
  rosterSnapshots,
  roundAreaResults,
  roundClassAreas,
  roundClassResults,
  rounds,
  roundStudentResults,
  scoreComponents,
  sessions,
  students,
  termClassZones,
  terms,
} from '../../../db/schema.ts';
import type { DbOrTx, Tx } from '../transaction.ts';

/** Audit `entity` values whose rows belong to one term (BR-D3); every other entity is "not tied to a term". */
export const TERM_AUDIT_ENTITIES = [
  'term',
  'round',
  'round_class_area',
  'evaluation',
  'request',
  'evidence',
  'duty',
  'appointment_order',
] as const;

/** Closed terms whose `purge_after` is before `today` (Bangkok date) and that still hold data. */
export const listTermsToPurge = (db: DbOrTx, today: string) =>
  db
    .select()
    .from(terms)
    .where(
      and(eq(terms.status, 'closed'), isNull(terms.purgedAt), isNotNull(terms.purgeAfter), lt(terms.purgeAfter, today)),
    );

/** Closed terms still holding data, oldest deadline first (BR-D2 warning and the privacy page). */
export const listClosedTerms = (db: DbOrTx) =>
  db.select().from(terms).where(eq(terms.status, 'closed')).orderBy(terms.purgeAfter);

/** Ids of everything under a term: they key both the deletes and the term's audit rows. */
export async function termContents(db: DbOrTx, termId: string) {
  const roundIds = (await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.termId, termId))).map((r) => r.id);
  const evals = roundIds.length
    ? await db.select({ id: evaluations.id }).from(evaluations).where(inArray(evaluations.roundId, roundIds))
    : [];
  const evalIds = evals.map((e) => e.id);
  const ev = evalIds.length
    ? await db
        .select({ id: evidence.id, filePath: evidence.filePath, sha256: evidence.sha256 })
        .from(evidence)
        .where(inArray(evidence.evaluationId, evalIds))
    : [];
  const pdfs = evalIds.length
    ? await db
        .select({ id: pdfDocuments.id, filePath: pdfDocuments.filePath })
        .from(pdfDocuments)
        .where(inArray(pdfDocuments.evaluationId, evalIds))
    : [];
  const reqIds = roundIds.length
    ? (await db.select({ id: requests.id }).from(requests).where(inArray(requests.roundId, roundIds))).map((r) => r.id)
    : [];
  const dutyIds = (await db.select({ id: duties.id }).from(duties).where(eq(duties.termId, termId))).map((d) => d.id);
  const orders = await db
    .select({ id: appointmentOrders.id, filePath: appointmentOrders.filePath })
    .from(appointmentOrders)
    .where(eq(appointmentOrders.termId, termId));
  return { roundIds, evalIds, evidence: ev, pdfs, reqIds, dutyIds, orders };
}

export type TermContents = Awaited<ReturnType<typeof termContents>>;

/**
 * BR-D3 database part, in FK order. Must run inside the transaction that also stamps `purged_at`.
 * Cascades: evaluation_student_scores (evaluations), round_component_max (rounds).
 */
export async function deleteTermData(tx: Tx, termId: string, c: TermContents) {
  const { roundIds, evalIds } = c;
  if (c.reqIds.length) await tx.delete(requests).where(inArray(requests.id, c.reqIds));
  if (evalIds.length) {
    await tx.delete(pdfDocuments).where(inArray(pdfDocuments.evaluationId, evalIds));
    await tx.delete(evidence).where(inArray(evidence.evaluationId, evalIds));
    await tx.delete(evaluations).where(inArray(evaluations.id, evalIds));
  }
  if (roundIds.length) {
    await tx.delete(roundStudentResults).where(inArray(roundStudentResults.roundId, roundIds));
    await tx.delete(roundClassResults).where(inArray(roundClassResults.roundId, roundIds));
    await tx.delete(roundAreaResults).where(inArray(roundAreaResults.roundId, roundIds));
    await tx.delete(rosterSnapshots).where(inArray(rosterSnapshots.roundId, roundIds));
    await tx.delete(roundClassAreas).where(inArray(roundClassAreas.roundId, roundIds));
    await tx.delete(rounds).where(inArray(rounds.id, roundIds));
  }
  await tx.delete(scoreComponents).where(eq(scoreComponents.termId, termId));
  await tx.delete(duties).where(eq(duties.termId, termId));
  await tx.delete(termClassZones).where(eq(termClassZones.termId, termId));
  await tx.delete(appointmentOrders).where(eq(appointmentOrders.termId, termId));
}

/** The audit table only accepts deletes from a transaction that opted in (migration 0004). */
async function allowAuditDelete(tx: Tx) {
  await tx.execute(sql`SELECT set_config('zw.retention', 'on', true)`);
}

/** Audit rows whose entity belongs to the term (BR-D3). Returns the number deleted. */
export async function deleteTermAudit(tx: Tx, termId: string, c: TermContents): Promise<number> {
  await allowAuditDelete(tx);
  const by = (entity: string, ids: string[]): SQL | undefined =>
    ids.length ? and(eq(auditLogs.entity, entity), inArray(auditLogs.entityId, ids)) : undefined;
  const conditions = [
    by('term', [termId]),
    by('round', c.roundIds),
    by('evaluation', c.evalIds),
    by('request', c.reqIds),
    by(
      'evidence',
      c.evidence.map((e) => e.id),
    ),
    by('duty', c.dutyIds),
    by(
      'appointment_order',
      c.orders.map((o) => o.id),
    ),
    ...c.roundIds.map((id) =>
      and(eq(auditLogs.entity, 'round_class_area'), sql`${auditLogs.entityId} LIKE ${`${id}:%`}`),
    ),
  ].filter((x): x is SQL => x !== undefined);
  const out = await tx
    .delete(auditLogs)
    .where(or(...conditions))
    .returning({ id: auditLogs.id });
  return out.length;
}

/** 12-security §3: audit rows not tied to a term are kept one year. */
export async function deleteOldAudit(tx: Tx, before: Date): Promise<number> {
  await allowAuditDelete(tx);
  const out = await tx
    .delete(auditLogs)
    .where(and(lt(auditLogs.at, before), notInArray(auditLogs.entity, [...TERM_AUDIT_ENTITIES])))
    .returning({ id: auditLogs.id });
  return out.length;
}

/** BR-D4: past `delete_after` and in no remaining snapshot. Cascades remove their per-student scores. */
export async function deleteExpiredStudents(tx: Tx, today: string): Promise<number> {
  const out = await tx
    .delete(students)
    .where(
      and(
        lt(students.deleteAfter, today),
        notExists(
          tx
            .select({ x: sql`1` })
            .from(rosterSnapshots)
            .where(eq(rosterSnapshots.studentId, students.id)),
        ),
      ),
    )
    .returning({ id: students.id });
  return out.length;
}

export async function deleteExpiredSessions(tx: Tx, now: Date): Promise<number> {
  const out = await tx.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  return out.length;
}

/** A stored file may back another evidence row (identical upload): only delete bytes nobody references. */
export async function evidenceShaInUse(db: DbOrTx, sha256: string): Promise<boolean> {
  const [row] = await db.select({ id: evidence.id }).from(evidence).where(eq(evidence.sha256, sha256)).limit(1);
  return row !== undefined;
}

/** All PDFs of a term for the archive ZIP (BR-D2), every version. */
export const listTermPdfs = (db: DbOrTx, termId: string) =>
  db
    .select({
      roundNo: rounds.roundNo,
      docNumber: pdfDocuments.docNumber,
      version: pdfDocuments.version,
      isDraft: pdfDocuments.isDraft,
      filePath: pdfDocuments.filePath,
    })
    .from(pdfDocuments)
    .innerJoin(evaluations, eq(evaluations.id, pdfDocuments.evaluationId))
    .innerJoin(rounds, eq(rounds.id, evaluations.roundId))
    .where(eq(rounds.termId, termId))
    .orderBy(rounds.roundNo, pdfDocuments.docNumber, pdfDocuments.version);
