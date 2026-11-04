import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateJudgment } from "../src/core/isolate.ts";
import type { ColumnEncoding, TableJudgment } from "../src/core/types.ts";

const EVIDENCE = {
  comparable: 1,
  polarity: { higher_is_better: 1, lower_is_better: 0, neutral: 0 },
  log: null,
  orderConfidence: null,
};

const judgment = (encodings: ColumnEncoding[], aggregateRows: number[] = []): TableJudgment => ({
  id: "t0",
  orientation: "columns",
  rowsScore: null,
  encodings,
  skipped: [],
  aggregateRows,
});

const quantitative = (over: Partial<Extract<ColumnEncoding, { kind: "quantitative" }>>): ColumnEncoding => ({
  kind: "quantitative",
  col: 1,
  header: "Price (USD)",
  polarity: "lower_is_better",
  transform: "linear",
  unit: "$",
  domain: [35, 249],
  values: [39, 54, 89],
  group: "shared:0",
  evidence: EVIDENCE,
  ...over,
});

test("a shared quantitative column rescales to its own extent", () => {
  const t = isolateJudgment(judgment([quantitative({})]));
  const e = t.encodings[0]!;
  assert.equal(e.kind, "quantitative");
  if (e.kind !== "quantitative") return;
  assert.deepEqual(e.domain, [39, 89]);
  assert.equal(e.group, null);
});

test("aggregate rows stay out of the isolated domain", () => {
  const t = isolateJudgment(judgment([quantitative({ values: [39, 54, 89, 182] })], [3]));
  const e = t.encodings[0]!;
  if (e.kind !== "quantitative") return;
  assert.deepEqual(e.domain, [39, 89]);
});

test("a shared log transform falls back to linear when the own domain is not positive", () => {
  const t = isolateJudgment(judgment([quantitative({ transform: "log", values: [0, 54, 89] })]));
  const e = t.encodings[0]!;
  if (e.kind !== "quantitative") return;
  assert.equal(e.transform, "linear");
  assert.deepEqual(e.domain, [0, 89]);
});

test("an unshared column and the rest of the judgment pass through unchanged", () => {
  const own = quantitative({ group: null, domain: [1, 2], values: [1, 2] });
  const t = isolateJudgment(judgment([own]));
  assert.equal(t.encodings[0], own);
});

test("a shared ordinal keeps only the levels the column shows", () => {
  const ordinal: ColumnEncoding = {
    kind: "ordinal",
    col: 2,
    header: "Tier",
    polarity: "higher_is_better",
    order: ["bronze", "silver", "gold", "platinum"],
    labels: ["Bronze", "Silver", "Gold", "Platinum"],
    values: ["silver", "gold", "silver"],
    group: "shared:1",
    evidence: EVIDENCE,
  };
  const t = isolateJudgment(judgment([ordinal]));
  const e = t.encodings[0]!;
  assert.equal(e.kind, "ordinal");
  if (e.kind !== "ordinal") return;
  assert.deepEqual(e.order, ["silver", "gold"]);
  assert.deepEqual(e.labels, ["Silver", "Gold"]);
  assert.equal(e.group, null);
});

test("a shared ordinal with one visible level keeps the shared order", () => {
  const ordinal: ColumnEncoding = {
    kind: "ordinal",
    col: 2,
    header: "Tier",
    polarity: "neutral",
    order: ["bronze", "silver", "gold"],
    labels: ["Bronze", "Silver", "Gold"],
    values: ["gold", "gold", null],
    group: "shared:1",
    evidence: EVIDENCE,
  };
  const t = isolateJudgment(judgment([ordinal]));
  const e = t.encodings[0]!;
  if (e.kind !== "ordinal") return;
  assert.deepEqual(e.order, ["bronze", "silver", "gold"]);
  assert.equal(e.group, null);
});
