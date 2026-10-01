import type { PgBoss } from 'pg-boss';
import type { Db } from '../../../db/client.ts';
import { createPdfRenderer, type PdfRenderer } from '../pdf/renderer.ts';
import { PDF_RENDER_QUEUE, renderEvaluationPdf, sweepQueuedPdfs } from '../services/pdf.service.ts';

/**
 * `pdf.render` (09-pdf §1, 11-jobs §1): one Chromium kept alive, concurrency 1, 60 s timeout, 3 retries with
 * backoff. Evaluations are queued by setting `pdf_status = queued`; the sweep turns those into jobs.
 */
export async function registerPdfJobs(boss: PgBoss, db: Db) {
  await boss.createQueue(PDF_RENDER_QUEUE, {
    policy: 'exclusive',
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 60,
  });
  let renderer: PdfRenderer | null = null;
  await boss.work<{ evaluationId: string }>(PDF_RENDER_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    renderer ??= await createPdfRenderer();
    const out = await renderEvaluationPdf(db, job.data.evaluationId, new Date(), renderer);
    if (out) console.log(`[worker] pdf.render ${job.data.evaluationId} v${out.version}`);
  });
  return {
    sweep: () =>
      sweepQueuedPdfs(db, (evaluationId) =>
        boss.send(PDF_RENDER_QUEUE, { evaluationId }, { singletonKey: evaluationId }),
      ).catch((err: unknown) => console.error('[worker] pdf sweep failed', err)),
    close: async () => {
      await renderer?.close();
    },
  };
}
