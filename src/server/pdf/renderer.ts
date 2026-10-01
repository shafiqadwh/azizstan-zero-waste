/**
 * Chromium printing for the worker (09-pdf §1): one browser kept alive, one page per job, A4 with the
 * template's own @page size. The page has no network: the HTML carries its fonts and images as data URIs.
 */
import { chromium, type Browser } from 'playwright-core';

export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
  close(): Promise<void>;
}

export async function createPdfRenderer(opts: { executablePath?: string } = {}): Promise<PdfRenderer> {
  let browser: Browser | null = null;
  const launch = async () => {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({
        executablePath: opts.executablePath ?? (process.env.CHROMIUM_PATH || undefined),
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return browser;
  };
  return {
    async render(html) {
      const context = await (await launch()).newContext({ offline: true, javaScriptEnabled: true });
      try {
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((img) =>
              img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)),
            ),
          );
        });
        return await page.pdf({
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
      } finally {
        await context.close();
      }
    },
    async close() {
      await browser?.close();
      browser = null;
    },
  };
}
