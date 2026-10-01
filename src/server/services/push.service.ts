/**
 * Web Push and the in-app inbox (11-jobs-notifications §2–3, T26). The inbox row is the source of truth; push is a
 * best-effort copy sent by the worker's `push.send` sweep:
 * - at most one push per user per type per 10 minutes — later rows wait and go out as one batched push;
 *   `evaluation_submitted` / `evaluation_changed` batches read "มีการใส่/แก้ไขคะแนนใหม่ {n} รายการ";
 * - a subscription answering 404/410 is deleted;
 * - rows older than a day are never pushed (inbox only).
 */
import webpush from 'web-push';
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import { parseInput } from '../errors.ts';
import type { SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/notifications.repository.ts';

export const PUSH_WINDOW_MS = 10 * 60_000;
const PUSH_MAX_AGE_MS = 24 * 3600_000;
const SCORE_TYPES = new Set(['evaluation_submitted', 'evaluation_changed']);

export interface PushPayload {
  title: string;
  body: string;
  link: string | null;
  tag: string;
}

export type PushResult = 'ok' | 'gone' | 'error';
export type PushSender = (
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
) => Promise<PushResult>;

/** VAPID sender from `.env`; null when the keys are not configured (push stays off, the inbox still works). */
export function webPushSender(env = process.env): PushSender | null {
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: 'normal' },
      );
      return 'ok';
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      return code === 404 || code === 410 ? 'gone' : 'error';
    }
  };
}

type Row = Awaited<ReturnType<typeof repo.listUnpushed>>[number];

/** One payload for a (user, type) group — the latest row, or the batched text. */
export function batchPayload(rows: Row[]): PushPayload {
  const latest = rows[rows.length - 1]!;
  const n = rows.length;
  if (n === 1) return { title: latest.title, body: latest.body, link: latest.link, tag: latest.type };
  if (SCORE_TYPES.has(latest.type))
    return {
      title: 'มีการใส่/แก้ไขคะแนนใหม่',
      body: `มีการใส่/แก้ไขคะแนนใหม่ ${n} รายการ`,
      link: '/monitor',
      tag: latest.type,
    };
  return { title: latest.title, body: `${latest.body} (และอีก ${n - 1} รายการ)`, link: latest.link, tag: latest.type };
}

/** Worker sweep `push.send` (every minute). */
export async function sweepPush(db: Db, sender: PushSender | null, now: Date) {
  const since = new Date(now.getTime() - PUSH_MAX_AGE_MS);
  await repo.markStaleAsPushed(db, since, now);
  const rows = await repo.listUnpushed(db, since);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.userId}|${r.type}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let pushes = 0;
  let waiting = 0;
  for (const group of groups.values()) {
    const { userId, type } = group[0]!;
    const last = await repo.lastPushedAt(db, userId, type);
    if (last && now.getTime() - last.getTime() < PUSH_WINDOW_MS) {
      waiting += group.length; // batched into the next push after the window
      continue;
    }
    const subs = sender ? await repo.listSubscriptions(db, userId) : [];
    if (subs.length > 0) {
      const payload = batchPayload(group);
      for (const sub of subs) {
        const result = await sender!(sub, payload);
        if (result === 'ok') await repo.markSubscriptionOk(db, sub.id, now);
        else if (result === 'gone') await repo.deleteSubscription(db, sub.endpoint);
      }
      pushes++;
    }
    await repo.markPushed(
      db,
      group.map((g) => g.id),
      now,
    );
  }
  return { pushes, waiting };
}

// ───────────── subscriptions (POST/DELETE /api/v1/push/subscription) ─────────────

export const subscriptionInput = z.object({
  endpoint: z.url().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export async function subscribePush(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof subscriptionInput>,
  userAgent: string | null,
  now: Date,
) {
  const input = parseInput(subscriptionInput, raw);
  await repo.upsertSubscription(db, {
    id: newId(),
    userId: actor.id,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    userAgent: userAgent?.slice(0, 300) ?? null,
    createdAt: now,
  });
}

export async function unsubscribePush(db: Db, actor: SessionUser, endpoint: string) {
  await repo.deleteSubscription(db, endpoint, actor.id);
}

// ───────────── inbox ─────────────

export async function getInbox(db: Db, actor: SessionUser) {
  const [items, unread] = await Promise.all([repo.listInbox(db, actor.id), repo.countUnread(db, actor.id)]);
  return {
    unread,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      createdAt: n.createdAt,
      read: n.readAt !== null,
    })),
  };
}

export const unreadCount = (db: Db, actor: SessionUser) => repo.countUnread(db, actor.id);

export async function markInboxRead(db: Db, actor: SessionUser, now: Date, ids?: string[]) {
  await repo.markRead(db, actor.id, now, ids);
}
