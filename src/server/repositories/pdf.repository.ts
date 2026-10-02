import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { evaluations, pdfDocuments } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type PdfRow = typeof pdfDocuments.$inferSelect;

export const listPdfs = (db: DbOrTx, evaluationId: string) =>
  db.select().from(pdfDocuments).where(eq(pdfDocuments.evaluationId, evaluationId)).orderBy(desc(pdfDocuments.version));

export async function findPdf(db: DbOrTx, id: string) {
  const [row] = await db.select().from(pdfDocuments).where(eq(pdfDocuments.id, id));
  return row ?? null;
}

/** Evaluations of a round that already have a document number (for the next running number). */
export async function countNumberedInRound(db: DbOrTx, roundId: string): Promise<number> {
  const ids = db.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.roundId, roundId));
  const rows = await db
    .selectDistinct({ id: pdfDocuments.evaluationId })
    .from(pdfDocuments)
    .where(inArray(pdfDocuments.evaluationId, ids));
  return rows.length;
}

export async function insertPdf(db: DbOrTx, row: typeof pdfDocuments.$inferInsert) {
  await db.insert(pdfDocuments).values(row);
}

export async function supersedeOthers(db: DbOrTx, evaluationId: string, keepId: string, at: Date) {
  await db
    .update(pdfDocuments)
    .set({ supersededAt: at })
    .where(
      and(eq(pdfDocuments.evaluationId, evaluationId), ne(pdfDocuments.id, keepId), isNull(pdfDocuments.supersededAt)),
    );
}

export const listQueuedEvaluationIds = async (db: DbOrTx, limit = 100) =>
  (
    await db.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.pdfStatus, 'queued')).limit(limit)
  ).map((r) => r.id);

export async function countPdfs(db: DbOrTx, evaluationId: string) {
  const [row] = await db.select({ n: count() }).from(pdfDocuments).where(eq(pdfDocuments.evaluationId, evaluationId));
  return row?.n ?? 0;
}

/** The current (not superseded) PDF of every evaluation of a round (monitor board). */
export const listCurrentPdfsInRound = (db: DbOrTx, roundId: string) =>
  db
    .select({ id: pdfDocuments.id, evaluationId: pdfDocuments.evaluationId })
    .from(pdfDocuments)
    .innerJoin(evaluations, eq(evaluations.id, pdfDocuments.evaluationId))
    .where(and(eq(evaluations.roundId, roundId), isNull(pdfDocuments.supersededAt)));

/** The current PDF of every evaluation in a round, in document-number order (merged export, FR-D5). */
export const listCurrentPdfFilesInRound = (db: DbOrTx, roundId: string) =>
  db
    .select({
      docNumber: pdfDocuments.docNumber,
      version: pdfDocuments.version,
      isDraft: pdfDocuments.isDraft,
      filePath: pdfDocuments.filePath,
      evaluationStatus: evaluations.status,
    })
    .from(pdfDocuments)
    .innerJoin(evaluations, eq(evaluations.id, pdfDocuments.evaluationId))
    .where(and(eq(evaluations.roundId, roundId), isNull(pdfDocuments.supersededAt)))
    .orderBy(pdfDocuments.docNumber);
