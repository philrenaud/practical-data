import { test } from "node:test";
import assert from "node:assert/strict";
import { afterSend, PACE_START, waitFor, type Pace } from "../src/ext/pace.ts";

/**
 * Simulates content.ts for a page that changes at the given times (ms). A change
 * starts a timer unless one is pending; when it fires, a request is sent.
 * Returns the send times.
 */
const simulate = (changes: readonly number[], until: number): number[] => {
  let pace: Pace = PACE_START;
  let due: number | null = null;
  const sent: number[] = [];
  const queue = [...changes];
  for (let now = 0; now <= until; now += 100) {
    if (due !== null && now >= due) {
      sent.push(now);
      pace = afterSend(pace, now);
      due = null;
    }
    while (queue.length > 0 && queue[0]! <= now) {
      queue.shift();
      if (due === null) due = now + waitFor(pace, now);
    }
  }
  return sent;
};

const everySecond = (from: number, to: number) => Array.from({ length: (to - from) / 1000 }, (_, i) => from + i * 1000);

test("one change sends one request after the first wait", () => {
  assert.deepEqual(simulate([5000], 60_000), [5600]);
});

test("a cell that changes every second for an hour sends at most 25 requests", () => {
  const sent = simulate(everySecond(0, 3_600_000), 3_600_000);
  assert.ok(sent.length <= 25, `${sent.length} requests`);
  // Shading still follows the page, at least every five minutes.
  const gaps = sent.slice(1).map((t, i) => t - sent[i]!);
  assert.ok(Math.max(...gaps) <= 5 * 60_000 + 1000, `longest gap ${Math.max(...gaps)} ms`);
});

test("after a quiet period, a change waits only the first delay again", () => {
  const busy = everySecond(0, 120_000);
  const sent = simulate([...busy, 1_000_000], 1_100_000);
  assert.equal(sent.at(-1), 1_000_600);
});
