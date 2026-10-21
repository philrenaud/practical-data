import { test } from "node:test";
import assert from "node:assert/strict";
import { mapConcurrent, sleep } from "../src/decide/concurrency.ts";

test("results come back in item order, with at most `limit` calls running", async () => {
  let running = 0;
  let most = 0;
  const results = await mapConcurrent([30, 10, 20, 0, 5], 2, async (ms) => {
    running++;
    most = Math.max(most, running);
    await sleep(ms);
    running--;
    return ms * 2;
  });
  assert.deepEqual(results, [60, 20, 40, 0, 10]);
  assert.equal(most, 2);
});

test("an empty list resolves at once", async () => {
  assert.deepEqual(await mapConcurrent([], 4, async () => 1), []);
});

test("the first failure rejects, aborts the running calls, and starts no more", async () => {
  const started: number[] = [];
  const aborted: number[] = [];
  const failure = new Error("first");
  const result = mapConcurrent([0, 1, 2, 3], 2, async (i, signal) => {
    started.push(i);
    signal.addEventListener("abort", () => aborted.push(i));
    if (i === 0) {
      await sleep(5);
      throw failure;
    }
    await sleep(1000, signal);
    return i;
  });
  await assert.rejects(result, (e) => e === failure);
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(aborted, [0, 1]);
});

test("an abort of the outer signal reaches the calls", async () => {
  const outer = new AbortController();
  const result = mapConcurrent([1], 1, (_, signal) => sleep(1000, signal), outer.signal);
  outer.abort(new Error("stop"));
  await assert.rejects(result, /stop/);
});

test("sleep rejects with the signal's reason when it aborts", async () => {
  const controller = new AbortController();
  const slept = sleep(1000, controller.signal);
  controller.abort(new Error("aborted"));
  await assert.rejects(slept, /aborted/);
  await assert.rejects(sleep(10, AbortSignal.abort(new Error("already"))), /already/);
});
