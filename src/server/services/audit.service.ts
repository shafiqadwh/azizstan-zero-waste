import { auditLogs } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export interface AuditEntry {
  /** null = system / worker (11-jobs §1). */
  actorId: string | null;
  /** `<entity>.<verb>`, e.g. `evaluation.approve`. */
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Append one audit row (FR-E10). Call it inside the mutation's transaction so the row and the change commit
 * or roll back together. The table is append-only (trigger in RAW_SQL). Never put student names in before/after.
 */
export async function writeAudit(db: DbOrTx, entry: AuditEntry, at: Date = new Date()): Promise<void> {
  await db.insert(auditLogs).values({
    at,
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
  });
}
