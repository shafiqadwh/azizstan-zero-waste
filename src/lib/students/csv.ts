/**
 * Student API CSV (10-integrations §1, BR-Y steps 2–3). The file has a header and 11 columns but is not clean:
 * unquoted commas inside the phone column, line breaks inside the province column, empty cells. Parsing keeps
 * only the 4 imported columns; every other value (national ID, birth date, parent, phone…) is dropped with the
 * row and never stored, logged or returned.
 */

export const EXPECTED_COLUMNS = 11;
const COL = { code: 0, name: 1, general: 2, religious: 3, phone: 9 } as const;

/** RFC 4180 records (quotes, "" escapes, CRLF/LF/CR), with a relaxed column count. */
export function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\r') {
      endRow();
      if (text[i + 1] === '\n') i++;
    } else if (ch === '\n') endRow();
    else field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

export interface StudentRow {
  code: string;
  fullName: string;
  general: string;
  religious: string;
}

export interface ParsedStudents {
  students: StudentRow[];
  /** rows that could not be repaired, by student code only (or `line N` when even the code is unusable) */
  malformed: string[];
  rows: number;
}

/**
 * BR-Y step 3: re-align by the header's column count. A short row is joined with the next physical line (a line
 * break inside a field, usually the province); a long row has the extra commas in the phone column, so fields
 * 9..(n−2) are merged. Anything still wrong is malformed.
 */
export function parseStudentCsv(text: string): ParsedStudents {
  const records = parseCsvRecords(text);
  const [header, ...body] = records;
  const width = header?.length ?? EXPECTED_COLUMNS;
  const students: StudentRow[] = [];
  const malformed: string[] = [];
  let rows = 0;
  for (let i = 0; i < body.length; i++) {
    let r = body[i]!;
    // (a) short: a field broke across lines — glue the next physical line onto the last field
    while (r.length < width && i + 1 < body.length) {
      const next = body[i + 1]!;
      if (r.length + next.length - 1 > width) break;
      r = [...r.slice(0, -1), `${r.at(-1)!} ${next[0] ?? ''}`.trim(), ...next.slice(1)];
      i++;
    }
    // (b) long: unquoted commas inside the phone column
    if (r.length > width) r = [...r.slice(0, COL.phone), r.slice(COL.phone, r.length - 1).join(','), r.at(-1)!];
    rows++;
    const code = (r[COL.code] ?? '').trim();
    if (r.length !== width || !/^[0-9A-Za-z-]{1,20}$/.test(code)) {
      malformed.push(/^[0-9A-Za-z-]{1,20}$/.test(code) ? code : `line ${i + 2}`);
      continue;
    }
    students.push({
      code,
      fullName: (r[COL.name] ?? '').trim().replace(/\s+/g, ' '),
      general: (r[COL.general] ?? '').trim(),
      religious: (r[COL.religious] ?? '').trim(),
    });
  }
  return { students, malformed, rows };
}
