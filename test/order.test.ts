import { test } from "node:test";
import assert from "node:assert/strict";
import { orderFromPairs } from "../src/core/order.ts";

const fromTruth = (labels: string[], truth: string[], noise: Record<string, number> = {}) => (i: number, j: number) => {
  const key = `${labels[i]}<${labels[j]}`;
  if (key in noise) return noise[key]!;
  return truth.indexOf(labels[i]!) < truth.indexOf(labels[j]!) ? 0.95 : 0.05;
};

test("recovers the true order from consistent pairs", () => {
  const labels = ["m", "xs", "xl", "s", "l"];
  const truth = ["xs", "s", "m", "l", "xl"];
  const got = orderFromPairs(labels, fromTruth(labels, truth));
  assert.deepEqual(got.order, truth);
  assert.ok(Math.abs(got.confidence - 0.95) < 1e-9);
});

test("a contradictory non-adjacent comparison does not flip the order", () => {
  const labels = ["c", "u", "r", "m"];
  const got = orderFromPairs(labels, fromTruth(labels, labels, { "c<r": 0.3 }));
  assert.deepEqual(got.order, ["c", "u", "r", "m"]);
  assert.ok(got.confidence < 0.95);
});
