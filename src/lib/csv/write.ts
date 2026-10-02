/**
 * RFC 4180 CSV for exports read by other programs (ปพ.5): UTF-8 with a BOM (Excel and Thai text), CRLF line ends,
 * fields quoted when needed. Text that starts with `=`, `+`, `-`, `@`, a tab or CR gets a leading `'` so spreadsheet
 * programs never run it as a formula (OWASP CSV injection); a plain negative number such as `-1.5` stays a number.
 */
export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
