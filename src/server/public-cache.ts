/**
 * Public pages read through this cache (05-api §3.1 "cached 60 s"): one tag for everything public, revalidated
 * on demand by the actions that change approved results or public content, and every 60 s otherwise (round
 * status changes made by the worker).
 */
import { revalidateTag, unstable_cache } from 'next/cache';
import { getDb } from './db';
import {
  getClassScores,
  getPublicGuidePage,
  getPublicSummary,
  getRankings,
  listPublicAreas,
  listPublicClasses,
  listPublicGuide,
  listPublicOrders,
} from './services/public.service';

export const PUBLIC_TAG = 'public';
const opts = { tags: [PUBLIC_TAG], revalidate: 60 };

export const publicSummary = unstable_cache(() => getPublicSummary(getDb(), new Date()), ['public-summary'], opts);
export const publicRankings = unstable_cache(
  (roundNo: number | null) => getRankings(getDb(), { roundNo }, new Date()),
  ['public-rankings'],
  opts,
);
export const publicClasses = unstable_cache(() => listPublicClasses(getDb(), new Date()), ['public-classes'], opts);
export const publicClassScores = unstable_cache(
  (classId: string) => getClassScores(getDb(), classId, new Date()),
  ['public-class-scores'],
  opts,
);
export const publicAreas = unstable_cache(() => listPublicAreas(getDb(), new Date()), ['public-areas'], opts);
export const publicOrders = unstable_cache(() => listPublicOrders(getDb()), ['public-orders'], opts);
export const publicGuide = unstable_cache(() => listPublicGuide(getDb()), ['public-guide'], opts);
export const publicGuidePage = unstable_cache(
  (slug: string) => getPublicGuidePage(getDb(), slug),
  ['public-guide-page'],
  opts,
);

/** Call after a change that public pages show (approved results, finalize, orders, guide). */
export function refreshPublic() {
  revalidateTag(PUBLIC_TAG, { expire: 0 });
}
