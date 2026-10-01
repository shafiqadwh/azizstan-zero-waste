/**
 * Sarabun 400/600/700 embedded as data URIs (09-pdf §2: local fonts only — the render page has no network).
 * Thai and Latin subsets are separate files, joined with unicode-range.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const THAI = 'U+0E01-0E5B, U+200C-200D, U+25CC';
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

let cached: Promise<string> | null = null;

export function fontsDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.FONTS_DIR ?? path.join(process.cwd(), 'fonts'));
}

/** `@font-face` rules for Sarabun, read once per process. */
export function sarabunCss(): Promise<string> {
  cached ??= (async () => {
    const rules: string[] = [];
    for (const weight of [400, 600, 700]) {
      for (const [subset, range] of [
        ['thai', THAI],
        ['latin', LATIN],
      ] as const) {
        const file = path.join(fontsDir(), 'sarabun', `sarabun-${subset}-${weight}-normal.woff2`);
        const b64 = (await readFile(file)).toString('base64');
        rules.push(
          `@font-face{font-family:'Sarabun';font-style:normal;font-weight:${weight};font-display:block;` +
            `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range};}`,
        );
      }
    }
    return rules.join('\n');
  })();
  return cached;
}
