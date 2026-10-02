/**
 * Offline evaluation drafts (07-frontend §3.5): the form state lives in IndexedDB under
 * `draft:{round}:{component}:{target}` so a dropped signal, a closed tab or a dead battery loses nothing.
 * Pure helpers here; the IndexedDB wrapper is `./draft-store.ts`.
 */

export const DRAFT_TTL_MS = 7 * 86_400_000;
/** Uploaded-but-unattached evidence is removed after 24 h (evidence-gc); re-upload from the kept blob before that. */
export const UPLOAD_REUSE_MS = 20 * 3_600_000;

export interface DraftPhoto {
  key: string;
  /** the shrunk JPEG, kept until the evaluation is submitted so it can be re-uploaded */
  blob: Blob;
  evidenceId?: string;
  uploadedAt?: number;
}

export interface Draft {
  key: string;
  updatedAt: number;
  /** thousandths, as the form holds it */
  score: number | null;
  /** individual mode (T40): thousandths per student id */
  studentScores?: Record<string, number | null>;
  comment: string;
  site: DraftPhoto[];
  signature: DraftPhoto[];
  /** the user pressed submit; send as soon as there is signal and every photo is uploaded */
  submitRequested: boolean;
}

/** Keyed by the signed-in user too: on a shared phone one teacher never gets another's draft. */
export const draftKey = (userId: string, roundId: string, componentId: string, target: string) =>
  `draft:${userId}:${roundId}:${componentId}:${target}`;

export const isExpired = (d: Pick<Draft, 'updatedAt'>, now: number) => now - d.updatedAt > DRAFT_TTL_MS;

/** A draft worth keeping: anything the user entered. An untouched form leaves no draft behind. */
export const hasContent = (d: Pick<Draft, 'score' | 'studentScores' | 'comment' | 'site' | 'signature'>) =>
  d.score !== null ||
  Object.values(d.studentScores ?? {}).some((v) => v !== null) ||
  d.comment.trim() !== '' ||
  d.site.length > 0 ||
  d.signature.length > 0;

/** The evidence id still usable on restore, or undefined when the photo must be uploaded again. */
export function reusableEvidence(p: DraftPhoto, now: number): string | undefined {
  if (!p.evidenceId || p.uploadedAt === undefined) return undefined;
  return now - p.uploadedAt < UPLOAD_REUSE_MS ? p.evidenceId : undefined;
}

/**
 * A failure worth retrying when the signal returns, as opposed to the server refusing the photo or the data.
 * `fetch` and server actions reject with a TypeError when the request never reached the server.
 */
export function isNetworkError(err: unknown, online: boolean): boolean {
  if (!online) return true;
  return err instanceof TypeError;
}
