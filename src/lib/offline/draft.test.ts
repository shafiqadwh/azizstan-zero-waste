import { describe, expect, it } from 'vitest';
import {
  DRAFT_TTL_MS,
  UPLOAD_REUSE_MS,
  draftKey,
  hasContent,
  isExpired,
  isNetworkError,
  reusableEvidence,
} from './draft';

const blob = new Blob(['x']);
const empty = { score: null, comment: '', site: [], signature: [] };

describe('offline drafts (07-frontend §3.5)', () => {
  it('keys a draft by round, component and target', () => {
    expect(draftKey('r1', 'c1', 'class:k1')).toBe('draft:r1:c1:class:k1');
  });

  it('clears drafts older than 7 days', () => {
    const now = 10 * DRAFT_TTL_MS;
    expect(isExpired({ updatedAt: now - DRAFT_TTL_MS }, now)).toBe(false);
    expect(isExpired({ updatedAt: now - DRAFT_TTL_MS - 1 }, now)).toBe(true);
  });

  it('keeps a draft only when something was entered (0 counts)', () => {
    expect(hasContent(empty)).toBe(false);
    expect(hasContent({ ...empty, comment: '   ' })).toBe(false);
    expect(hasContent({ ...empty, score: 0 })).toBe(true);
    expect(hasContent({ ...empty, comment: 'ดี' })).toBe(true);
    expect(hasContent({ ...empty, signature: [{ key: 'a', blob }] })).toBe(true);
  });

  it('reuses an uploaded photo only before the orphan clean-up can remove it', () => {
    const now = 100 * UPLOAD_REUSE_MS;
    expect(reusableEvidence({ key: 'a', blob }, now)).toBeUndefined();
    expect(reusableEvidence({ key: 'a', blob, evidenceId: 'e1' }, now)).toBeUndefined();
    expect(reusableEvidence({ key: 'a', blob, evidenceId: 'e1', uploadedAt: now - 1000 }, now)).toBe('e1');
    expect(reusableEvidence({ key: 'a', blob, evidenceId: 'e1', uploadedAt: now - UPLOAD_REUSE_MS }, now)).toBe(
      undefined,
    );
  });

  it('retries network failures, not server refusals', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'), true)).toBe(true);
    expect(isNetworkError(new Error('ไฟล์ใหญ่เกินไป'), false)).toBe(true);
    expect(isNetworkError(new Error('ไฟล์ใหญ่เกินไป'), true)).toBe(false);
  });
});
