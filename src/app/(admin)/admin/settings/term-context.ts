import 'server-only';
import type { SessionUser } from '@/server/policies';
import { getDb } from '@/server/db';
import { listTerms } from '@/server/services/term.service';

/** Settings pages work on one term: ?term=…, else the active term, else the newest one. */
export async function resolveSettingsTerm(user: SessionUser, termParam: string | undefined) {
  const terms = await listTerms(getDb(), user);
  const selected =
    terms.find((t) => t.id === termParam) ?? terms.find((t) => t.status === 'active') ?? terms[0] ?? null;
  return { terms, selected };
}
