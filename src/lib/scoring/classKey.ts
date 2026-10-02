/**
 * Class string normalization for the student API (docs/04-business-rules.md §9.2).
 * Returns a lookup key; the key is resolved to a class through class_aliases.
 */

export interface ParsedGeneral {
  gradeLabel: string; // 'ม.1'
  roomNo: number;     // 1  (sort only)
  name: string;       // 'Amanah'
}

/** Trim, NFC, collapse spaces, unify apostrophes and dots. */
export function normalizeClassString(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/ม\s*\.\s*/g, 'ม.')
    .replace(/ปวช\s*\.\s*/g, 'ปวช.')
    .replace(/อก\s*\.\s*/g, 'อก.')
    .trim();
}

const GENERAL = /^ม\.(\d)\s*\/\s*(\d{1,2})\s+(.+)$/;

/** "ม.1/1 Amanah" → { gradeLabel:'ม.1', roomNo:1, name:'Amanah' }; anything else → null. */
export function parseGeneralClass(raw: string): ParsedGeneral | null {
  const s = normalizeClassString(raw);
  const m = GENERAL.exec(s);
  if (!m) return null;
  return { gradeLabel: `ม.${m[1]}`, roomNo: Number(m[2]), name: m[3].trim() };
}

/**
 * Key used to look up class_aliases (case-insensitive).
 *   "ม.1/1 Amanah"  → "ม.1|amanah"
 *   "PR 1/1 Amanah" → "pr1|amanah"
 *   "อก.1/3 Cergas" → "อก.1|cergas"
 *   "ปวช.2/1"       → "ปวช.2|ปวช.2/1"
 *   anything else   → normalized string, lower-cased
 * Returns null for empty cells.
 */
export function classLookupKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = normalizeClassString(raw);
  if (s === '' || s === '-') return null;
  const g = parseGeneralClass(s);
  if (g) return `${g.gradeLabel}|${g.name}`.toLowerCase();
  const rel = /^(PR|อก\.)\s*(\d)\s*\/\s*\d{1,2}\s+(.+)$/i.exec(s);
  if (rel) return `${rel[1].replace(/\s/g, '')}${rel[2]}|${rel[3].trim()}`.toLowerCase();
  const voc = /^ปวช\.(\d)\s*\/\s*(\d)$/.exec(s);
  if (voc) return `ปวช.${voc[1]}|ปวช.${voc[1]}/${voc[2]}`;
  return s.toLowerCase();
}

/** FR-R10: general class if present, else religious class. */
export function homeClassKey(generalRaw: string | null | undefined, religiousRaw: string | null | undefined): string | null {
  return classLookupKey(generalRaw) ?? classLookupKey(religiousRaw);
}

/** Known misspellings in the student API → the class name to create (10-integrations §1.4 seed aliases). */
const CANONICAL_NAMES: Record<string, string> = {
  'usaha(ijtihad)': 'Usaha',
  iklas: 'Ikhlas',
  biruni: 'Al-Biruni',
  'al-khawarizmi': 'Al-Khawarizmi',
  "ash-shafi'i": "Ash-Shafi'i",
};

export interface ClassDraft {
  track: 'general' | 'vocational';
  gradeCode: string;
  gradeLabel: string;
  rankGroup: string;
  roomNo: number;
  name: string;
  displayName: string;
}

/**
 * A class the student sync may create by itself when the register has no match (BR-Y step 4b):
 *   "ม.1/1 Amanah" → general M1 "ม.1 Amanah" (room 1) · "ปวช.2/1" → vocational VOC2 "ปวช.2/1"
 * Religious classes (ซานาวี, chosen per term; มุตะวัซซิต skipped) and anything else return null and go to review.
 */
export function classDraftFrom(raw: string | null | undefined): ClassDraft | null {
  if (!raw) return null;
  const s = normalizeClassString(raw);
  const g = parseGeneralClass(s);
  if (g) {
    const grade = Number(g.gradeLabel.slice(2));
    if (grade < 1 || grade > 6) return null;
    const name = CANONICAL_NAMES[g.name.toLowerCase()] ?? g.name;
    return {
      track: 'general',
      gradeCode: `M${grade}`,
      gradeLabel: g.gradeLabel,
      rankGroup: g.gradeLabel,
      roomNo: g.roomNo,
      name,
      displayName: `${g.gradeLabel} ${name}`,
    };
  }
  const voc = /^ปวช\.([1-3])\s*\/\s*(\d{1,2})$/.exec(s);
  if (voc) {
    const name = `ปวช.${voc[1]}/${Number(voc[2])}`;
    return {
      track: 'vocational',
      gradeCode: `VOC${voc[1]}`,
      gradeLabel: `ปวช.${voc[1]}`,
      rankGroup: 'ปวช.',
      roomNo: Number(voc[2]),
      name,
      displayName: name,
    };
  }
  return null;
}
