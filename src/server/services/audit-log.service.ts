/**
 * The audit log viewer `/admin/audit` (12-security §2 item 8): admins, executives and the super admin read it;
 * nobody edits it (append-only table). before/after pass through the log redaction, so a stray secret-named field
 * never reaches the page.
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/audit.repository.ts';
import { redact } from '../log.ts';

export const AUDIT_PAGE_SIZE = 50;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

/** URL search params → filter. Bad values are dropped, never an error page. */
export const auditQuery = z.object({
  entity: z
    .string()
    .max(40)
    .regex(/^[a-z_]*$/)
    .optional()
    .catch(undefined),
  action: z.string().max(60).optional().catch(undefined),
  actor: z.string().max(100).optional().catch(undefined),
  id: z.string().max(100).optional().catch(undefined),
  from: dateOnly,
  to: dateOnly,
  before: z.coerce.number().int().positive().optional().catch(undefined),
});
export type AuditQuery = z.infer<typeof auditQuery>;

const bangkokDayStart = (d: string) => new Date(`${d}T00:00:00+07:00`);

export async function getAuditLog(db: Db, actor: SessionUser, raw: Record<string, string | undefined>) {
  assertCan(actor, 'staff.read');
  const q = auditQuery.parse(raw);
  const rows = await repo.listAudit(
    db,
    {
      entity: q.entity || undefined,
      action: q.action?.trim() || undefined,
      actor: q.actor?.trim() || undefined,
      entityId: q.id?.trim() || undefined,
      from: q.from ? bangkokDayStart(q.from) : undefined,
      to: q.to ? new Date(bangkokDayStart(q.to).getTime() + 86_400_000) : undefined,
      before: q.before,
    },
    AUDIT_PAGE_SIZE + 1,
  );
  const page = rows.slice(0, AUDIT_PAGE_SIZE).map((r) => ({
    ...r,
    actor: r.actorUsername ? `${r.actorName} (${r.actorUsername})` : r.actorName === null ? 'ระบบ' : '–',
    before: r.before === null ? null : redact(r.before),
    after: r.after === null ? null : redact(r.after),
  }));
  return {
    query: q,
    rows: page,
    nextBefore: rows.length > AUDIT_PAGE_SIZE ? page[page.length - 1]!.id : null,
    entities: await repo.listAuditEntities(db),
  };
}
