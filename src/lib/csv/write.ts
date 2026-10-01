/**
 * RFC 4180 CSV for exports read by other programs (ปพ.5): UTF-8 with a BOM (Excel and Thai text), CRLF line ends,
 * fields quoted when needed. Text that starts with `=`, `+` or `@` gets a leading `'` so spreadsheet programs
 * never run it as a formula.
 */
export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (typeof v === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
