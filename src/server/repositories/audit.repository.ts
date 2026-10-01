import { and, desc, eq, gte, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { auditLogs, users } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export interface AuditFilter {
  entity?: string;
  /** substring of the action code, e.g. "approve" */
  action?: string;
  /** actor username (exact, case-insensitive); "system" = the worker */
  actor?: string;
  /** exact entity id */
  entityId?: string;
  from?: Date;
  to?: Date;
  /** keyset paging: rows with id < before */
  before?: number;
}

export async function listAudit(db: DbOrTx, f: AuditFilter, limit: number) {
  const where: (SQL | undefined)[] = [
    f.entity ? eq(auditLogs.entity, f.entity) : undefined,
    f.action ? ilike(auditLogs.action, `%${f.action.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    f.entityId ? eq(auditLogs.entityId, f.entityId) : undefined,
    f.from ? gte(auditLogs.at, f.from) : undefined,
    f.to ? lt(auditLogs.at, f.to) : undefined,
    f.before ? lt(auditLogs.id, f.before) : undefined,
    f.actor === 'system'
      ? sql`${auditLogs.actorId} IS NULL`
      : f.actor
        ? sql`lower(${users.username}) = lower(${f.actor})`
        : undefined,
  ];
  return db
    .select({
      id: auditLogs.id,
      at: auditLogs.at,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      before: auditLogs.before,
      after: auditLogs.after,
      ip: auditLogs.ip,
      actorName: users.displayName,
      actorUsername: users.username,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(...where))
    .orderBy(desc(auditLogs.id))
    .limit(limit);
}

export async function listAuditEntities(db: DbOrTx): Promise<string[]> {
  const rows = await db.selectDistinct({ entity: auditLogs.entity }).from(auditLogs).orderBy(auditLogs.entity);
  return rows.map((r) => r.entity);
}
