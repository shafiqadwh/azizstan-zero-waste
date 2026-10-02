/** IndexedDB home of evaluation drafts (07-frontend §3.5). Every call fails soft: no IndexedDB → no draft. */
import { draftPrefix, isExpired, type Draft } from './draft';

const DB_NAME = 'zw-offline';
const STORE = 'drafts';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const soft = async <T>(p: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p();
  } catch {
    return fallback;
  }
};

export const readDraft = (key: string) =>
  soft(async () => (await run<Draft | undefined>('readonly', (s) => s.get(key))) ?? null, null);

export const saveDraft = (draft: Draft) => soft(() => run('readwrite', (s) => s.put(draft)).then(() => true), false);

export const deleteDraft = (key: string) => soft(() => run('readwrite', (s) => s.delete(key)).then(() => true), false);

/** Drafts older than 7 days are cleared (07-frontend §3.5). Returns how many were removed. */
export const purgeExpiredDrafts = (now: number) =>
  soft(async () => {
    const all = await run<Draft[]>('readonly', (s) => s.getAll());
    const old = all.filter((d) => isExpired(d, now));
    for (const d of old) await run('readwrite', (s) => s.delete(d.key));
    return old.length;
  }, 0);

/** Keys of one user's drafts on this device (key range on the `draft:{userId}:` prefix). */
const keysOf = (userId: string) => {
  const prefix = draftPrefix(userId);
  return run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
};

export const countDraftsOf = (userId: string) => soft(async () => (await keysOf(userId)).length, 0);

/** Logout (12-security §2 item 13): the user's drafts, photos included, leave the device. Returns how many. */
export const deleteDraftsOf = (userId: string) =>
  soft(async () => {
    const keys = await keysOf(userId);
    for (const k of keys) await run('readwrite', (s) => s.delete(k));
    return keys.length;
  }, 0);
