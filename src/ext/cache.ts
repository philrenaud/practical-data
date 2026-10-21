/** The answer cache the service worker keeps in chrome.storage.local. */
import type { AnswerCache, DecisionResponse } from "../decide/model.ts";

/** Versioned so a change in answer format never replays old entries. */
export const CACHE_PREFIX = "answers:v2:";
const CACHE_INDEX = "answers:v2:index";
/**
 * Pages whose numbers change on every load add a new entry each time, so the
 * cache keeps the newest. The cap keeps it well inside storage.local's default
 * 10 MB quota.
 */
export const CACHE_MAX = 1500;
const CACHE_EVICT = 300;

/** The part of chrome.storage.StorageArea the cache uses. */
export interface Store {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/**
 * Returns an AnswerCache backed by `store`. Entries persist across sessions,
 * so an unchanged table costs nothing on a second visit. model.ts re-validates
 * each entry on read. Writes are best-effort, because a full or failing store
 * must not fail a judgment.
 */
export const answerCache = (store: Store): AnswerCache => {
  // Each write reads and rewrites the index. Concurrent writes would drop each
  // other's keys, and an entry missing from the index is never evicted.
  let writes = Promise.resolve();
  const write = async (key: string, value: DecisionResponse) => {
    try {
      const stored = await store.get(CACHE_INDEX);
      const index = (stored[CACHE_INDEX] as string[] | undefined) ?? [];
      index.push(key);
      const evicted = index.length > CACHE_MAX ? index.splice(0, CACHE_EVICT) : [];
      await store.set({ [CACHE_PREFIX + key]: value, [CACHE_INDEX]: index });
      if (evicted.length > 0) await store.remove(evicted.map((k) => CACHE_PREFIX + k));
    } catch {
      // Best effort.
    }
  };
  return {
    get: async (key) => {
      const k = CACHE_PREFIX + key;
      const hit = await store.get(k).catch(() => ({}) as Record<string, unknown>);
      return hit[k] as DecisionResponse | undefined;
    },
    set: (key, value) => {
      writes = writes.then(() => write(key, value));
      return writes;
    },
  };
};
