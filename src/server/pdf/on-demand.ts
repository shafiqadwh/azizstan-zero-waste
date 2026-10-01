/**
 * PDFs rendered in the web process on request (09-pdf §3: generated on demand, not stored). The shared image
 * already carries Chromium for the worker; here one browser starts on first use and closes after a minute idle,
 * so the app does not hold ~100 MB for a feature used a few times per round.
 */
import { createPdfRenderer, type PdfRenderer } from './renderer.ts';

const IDLE_MS = 60_000;
const g = globalThis as typeof globalThis & {
  __zwOnDemandPdf?: {
    renderer: Promise<PdfRenderer>;
    timer: ReturnType<typeof setTimeout> | null;
    queue: Promise<unknown>;
  };
};

export async function renderPdfOnDemand(html: string): Promise<Buffer> {
  g.__zwOnDemandPdf ??= { renderer: createPdfRenderer(), timer: null, queue: Promise.resolve() };
  const state = g.__zwOnDemandPdf;
  if (state.timer) clearTimeout(state.timer);
  // one page at a time: requests queue behind each other instead of opening many contexts
  const job = state.queue.then(async () => (await state.renderer).render(html));
  state.queue = job.catch(() => undefined);
  try {
    return await job;
  } finally {
    state.timer = setTimeout(() => {
      if (g.__zwOnDemandPdf !== state) return;
      g.__zwOnDemandPdf = undefined;
      void state.renderer.then((r) => r.close()).catch(() => undefined);
    }, IDLE_MS);
    state.timer.unref?.();
  }
}
