/**
 * BR-E1 content rules for submit / edit / resubmit, shared by the service and the committee form (T19).
 * Messages are the exact copy of 08-ux-ui §9. Pure: no I/O.
 */
import { checkScore } from '../scoring/index.ts';
import { toDisplay, type Th } from '../scoring/decimal.ts';
import { trimScore } from '../term/config.ts';

export const EVAL_MSG = {
  scoreRequired: 'กรุณาเลือกคะแนน (ถ้าไม่ให้คะแนน ให้เลือก 0)',
  scoreStep: (step: string) => `คะแนนต้องเป็นทีละ ${step}`,
  scoreRange: (max: string) => `คะแนนต้องอยู่ระหว่าง 0 ถึง ${max}`,
  studentsMissing: (n: number) => `ยังไม่ได้ให้คะแนนนักเรียนอีก ${n} คน`,
  studentsUnknown: 'มีนักเรียนที่ไม่อยู่ในห้องนี้ในรอบนี้',
  studentsNone: 'ยังไม่มีรายชื่อนักเรียนของห้องนี้ในรอบนี้ แจ้งผู้ดูแลระบบให้ซิงก์รายชื่อก่อน',
  photosMin: (n: number) => `ต้องถ่ายรูปอีก ${n} รูป`,
  photosMax: (max: number) => `ถ่ายได้สูงสุด ${max} รูป`,
  signatureRequired: 'กรุณาถ่ายรูปใบลงชื่อนักเรียน',
  signatureNotUsed: 'ส่วนคะแนนนี้ไม่ใช้ใบลงชื่อนักเรียน',
  commentMax: (max: number) => `ข้อติชมยาวเกิน ${max} ตัวอักษร`,
} as const;

export interface ContentRules {
  max: Th;
  step: Th;
  photoMin: number;
  photoMax: number;
  requiresSignature: boolean;
  commentMax: number;
  /** Individual mode: the class's roster snapshot for the round; null in group mode. */
  rosterIds: readonly string[] | null;
}

export interface Content {
  score: Th | null;
  studentScores: ReadonlyMap<string, Th | null>;
  siteCount: number;
  hasSignature: boolean;
  comment: string;
}

export type ContentError = {
  field: 'score' | 'studentScores' | 'sitePhotos' | 'signature' | 'comment';
  message: string;
};

const show = (th: Th) => trimScore(toDisplay(th));

function scoreError(value: Th | null, rules: ContentRules): string | null {
  const check = checkScore(value, rules.max, rules.step);
  if (check.ok) return null;
  if (check.code === 'required') return EVAL_MSG.scoreRequired;
  if (check.code === 'range') return EVAL_MSG.scoreRange(show(rules.max));
  return EVAL_MSG.scoreStep(show(rules.step));
}

/** First problem in field order (score → photos → signature → comment), or null when the content may be sent. */
export function checkContent(content: Content, rules: ContentRules): ContentError | null {
  if (rules.rosterIds) {
    // no snapshot → the class mean would never exist and the class could never get a total (BR-S2)
    if (rules.rosterIds.length === 0) return { field: 'studentScores', message: EVAL_MSG.studentsNone };
    const roster = new Set(rules.rosterIds);
    if ([...content.studentScores.keys()].some((id) => !roster.has(id)))
      return { field: 'studentScores', message: EVAL_MSG.studentsUnknown };
    const missing = rules.rosterIds.filter((id) => content.studentScores.get(id) == null).length;
    if (missing > 0) return { field: 'studentScores', message: EVAL_MSG.studentsMissing(missing) };
    for (const id of rules.rosterIds) {
      const err = scoreError(content.studentScores.get(id) ?? null, rules);
      if (err) return { field: 'studentScores', message: err };
    }
  } else {
    const err = scoreError(content.score, rules);
    if (err) return { field: 'score', message: err };
  }
  if (content.siteCount < rules.photoMin)
    return { field: 'sitePhotos', message: EVAL_MSG.photosMin(rules.photoMin - content.siteCount) };
  if (content.siteCount > rules.photoMax) return { field: 'sitePhotos', message: EVAL_MSG.photosMax(rules.photoMax) };
  if (rules.requiresSignature && !content.hasSignature)
    return { field: 'signature', message: EVAL_MSG.signatureRequired };
  if (!rules.requiresSignature && content.hasSignature)
    return { field: 'signature', message: EVAL_MSG.signatureNotUsed };
  if ([...content.comment].length > rules.commentMax)
    return { field: 'comment', message: EVAL_MSG.commentMax(rules.commentMax) };
  return null;
}
