/**
 * Job `evidence.gc` (BR-V4, 11-jobs §1): uploads never attached to an evaluation within 24 h are deleted —
 * the row, the file and its cached thumbnails. Kept free of sharp so the worker bundle stays small.
 */
import type { Db } from '../../../db/client.ts';
import { THUMB_WIDTHS } from '../evidence/paths.ts';
import * as repo from '../repositories/evidence.repository.ts';
import { dataDir, removeDataFile } from '../storage.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';

export const EVIDENCE_GC_QUEUE = 'evidence.gc';
export const ORPHAN_TTL_MS = 24 * 3600_000;

export async function gcOrphanEvidence(db: Db, now: Date, opts: { root?: string } = {}): Promise<{ deleted: number }> {
  const orphans = await repo.listOrphansBefore(db, new Date(now.getTime() - ORPHAN_TTL_MS));
  if (orphans.length === 0) return { deleted: 0 };
  await withTransaction(db, async (tx) => {
    await repo.deleteEvidence(
      tx,
      orphans.map((o) => o.id),
    );
    await writeAudit(
      tx,
      {
        actorId: null,
        action: 'evidence.gc',
        entity: 'evidence',
        entityId: 'orphans',
        after: { ids: orphans.map((o) => o.id) },
      },
      now,
    );
  });
  // Files after the commit; the same photo bytes may still back another row (identical upload).
  for (const o of orphans) {
    if ((await repo.countBySha(db, o.sha256)) > 0) continue;
    const root = opts.root ?? dataDir();
    await removeDataFile(o.filePath, root);
    for (const w of THUMB_WIDTHS) await removeDataFile(o.filePath.replace(/\.webp$/, `_w${w}.webp`), root);
  }
  return { deleted: orphans.length };
}
