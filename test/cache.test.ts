import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import type { DecisionResponse } from "../src/decide/model.ts";
import { answerCache, CACHE_MAX, CACHE_PREFIX, type Store } from "../src/ext/cache.ts";

/** An in-memory store that, like chrome.storage, answers each call on a later task. */
const memoryStore = () => {
  const data = new Map<string, unknown>();
  const later = () => new Promise((resolve) => setTimeout(resolve, 0));
  const store: Store = {
    get: async (key) => {
      await later();
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    set: async (items) => {
      await later();
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    remove: async (keys) => {
      await later();
      for (const k of keys) data.delete(k);
    },
  };
  return { data, store };
};

const answer = (n: number): DecisionResponse => ({
  model: "test",
  answers: { [`q${n}`]: { type: "noul", noul: 0.5 } },
  usage: { input_tokens: n },
});

const entries = (data: Map<string, unknown>) =>
  [...data.keys()].filter((k) => k.startsWith(CACHE_PREFIX) && !k.endsWith("index")).length;

test("a stored answer reads back", async () => {
  const { store } = memoryStore();
  const cache = answerCache(store);
  await Effect.runPromise(cache.set("k", answer(1)));
  assert.deepEqual(await Effect.runPromise(cache.get("k")), answer(1));
  assert.equal(await Effect.runPromise(cache.get("missing")), undefined);
});

test("concurrent writes stay within the cap", async () => {
  const { data, store } = memoryStore();
  const cache = answerCache(store);
  // The model layer writes several answers at once; every one must reach the index, or it is never evicted.
  const writes = Array.from({ length: CACHE_MAX + 200 }, (_, i) => cache.set(`k${i}`, answer(i)));
  await Effect.runPromise(Effect.all(writes, { concurrency: 8 }));
  assert.ok(entries(data) <= CACHE_MAX, `${entries(data)} entries stored, cap is ${CACHE_MAX}`);
  assert.deepEqual(await Effect.runPromise(cache.get(`k${CACHE_MAX + 199}`)), answer(CACHE_MAX + 199));
});
