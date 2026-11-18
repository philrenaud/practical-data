import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateJudgment } from "../src/core/isolate.ts";
import {
  applyRanges,
  EMPTY_RANGES,
  RANGE_LIMITS,
  rangeTableKey,
  readRanges,
  setRange,
  type PageRanges,
} from "../src/core/range.ts";
import { positions } from "../src/core/scale.ts";
import type { ColumnEncoding, TableJudgment } from "../src/core/types.ts";

const EVIDENCE = {
  comparable: 1,
  polarity: { higher_is_better: 1, lower_is_better: 0, neutral: 0 },
  log: null,
  orderConfidence: null,
};

type Quantitative = Extract<ColumnEncoding, { kind: "quantitative" }>;

const quantitative = (over: Partial<Quantitative> = {}): Quantitative => ({
  kind: "quantitative",
  col: 1,
  header: "Win rate",
  polarity: "higher_is_better",
  transform: "linear",
  unit: "%",
  domain: [25, 28],
  values: [25, 26.5, 28],
  group: null,
  evidence: EVIDENCE,
  ...over,
});

const judgment = (encodings: ColumnEncoding[]): TableJudgment => ({
  id: "t0",
  orientation: "columns",
  rowsScore: null,
  encodings,
  skipped: [],
  aggregateRows: [],
});

const first = (t: TableJudgment): Quantitative => {
  const e = t.encodings[0]!;
  assert.equal(e.kind, "quantitative");
  return e as Quantitative;
};

const ranges = (over: Partial<PageRanges>): PageRanges => ({ ...EMPTY_RANGES, ...over });

test("a judgment with no saved range is returned as it is", () => {
  const t = judgment([quantitative()]);
  assert.equal(applyRanges(t, "k", EMPTY_RANGES), t);
});

test("a saved range replaces the column's domain and keeps the fitted one", () => {
  const t = applyRanges(judgment([quantitative()]), "k", ranges({ tables: { k: { "Win rate": [0, 100] } } }));
  const e = first(t);
  assert.deepEqual(e.domain, [0, 100]);
  assert.deepEqual(e.fit, [25, 28]);
});

test("on a wider range the lowest and highest values sit close together", () => {
  const t = applyRanges(judgment([quantitative()]), "k", ranges({ tables: { k: { "Win rate": [0, 100] } } }));
  assert.deepEqual(positions(first(t)), [0.25, 0.265, 0.28]);
});

test("values outside a narrower range take the end of the scale", () => {
  const t = applyRanges(judgment([quantitative()]), "k", ranges({ tables: { k: { "Win rate": [26, 27] } } }));
  assert.deepEqual(positions(first(t)), [0, 0.5, 1]);
});

test("a range saved for another table is not applied", () => {
  const t = judgment([quantitative()]);
  assert.equal(applyRanges(t, "k", ranges({ tables: { other: { "Win rate": [0, 100] } } })), t);
});

test("an ordinal column is never rescaled", () => {
  const ordinal: ColumnEncoding = {
    kind: "ordinal",
    col: 1,
    header: "Win rate",
    polarity: "neutral",
    order: ["low", "high"],
    labels: ["Low", "High"],
    values: ["low", "high"],
    group: null,
    evidence: EVIDENCE,
  };
  const t = judgment([ordinal]);
  assert.equal(applyRanges(t, "k", ranges({ tables: { k: { "Win rate": [0, 100] } } })), t);
});

test("a range that reaches zero turns a log scale linear", () => {
  const log = quantitative({ transform: "log", domain: [2, 2000], values: [2, 200, 2000] });
  const e = first(applyRanges(judgment([log]), "k", ranges({ tables: { k: { "Win rate": [0, 2000] } } })));
  assert.equal(e.transform, "linear");
  const kept = first(applyRanges(judgment([log]), "k", ranges({ tables: { k: { "Win rate": [1, 5000] } } })));
  assert.equal(kept.transform, "log");
});

test("an unusable saved range is ignored", () => {
  const t = judgment([quantitative()]);
  for (const bad of [
    [100, 0],
    [5, 5],
    [0, Infinity],
    [NaN, 3],
  ] as const) {
    assert.equal(applyRanges(t, "k", ranges({ tables: { k: { "Win rate": bad } } })), t, String(bad));
  }
});

test("columns with the same header keep separate ranges", () => {
  const t = judgment([quantitative({ col: 1 }), quantitative({ col: 2 })]);
  const saved = setRange(EMPTY_RANGES, t, "k", 2, [0, 100]);
  const shown = applyRanges(t, "k", saved);
  assert.deepEqual((shown.encodings[0] as Quantitative).domain, [25, 28]);
  assert.deepEqual((shown.encodings[1] as Quantitative).domain, [0, 100]);
});

test("a range on a shared scale applies to every table that shares it", () => {
  const a = judgment([quantitative({ group: "shared:0", domain: [10, 60] })]);
  const b = judgment([quantitative({ group: "shared:0", domain: [10, 60], values: [10, 60] })]);
  const saved = setRange(EMPTY_RANGES, a, "ka", 1, [0, 100]);
  assert.deepEqual(saved, { shared: { "Win rate": [0, 100] }, tables: {} });
  assert.deepEqual(first(applyRanges(a, "ka", saved)).domain, [0, 100]);
  assert.deepEqual(first(applyRanges(b, "kb", saved)).domain, [0, 100]);
  assert.deepEqual(first(applyRanges(b, "kb", saved)).fit, [10, 60]);
});

test("an isolated table ignores the shared range and takes its own", () => {
  const shared = judgment([quantitative({ group: "shared:0", domain: [10, 60] })]);
  const isolated = isolateJudgment(shared);
  const page = setRange(EMPTY_RANGES, shared, "k", 1, [0, 100]);
  assert.deepEqual(first(applyRanges(isolated, "k", page)).domain, [25, 28]);

  const own = setRange(page, isolated, "k", 1, [20, 30]);
  assert.deepEqual(own, { shared: { "Win rate": [0, 100] }, tables: { k: { "Win rate": [20, 30] } } });
  assert.deepEqual(first(applyRanges(isolated, "k", own)).domain, [20, 30]);
  assert.deepEqual(first(applyRanges(shared, "k", own)).domain, [0, 100]);
});

test("a shared range does not reach a column that shares no scale", () => {
  const t = judgment([quantitative()]);
  assert.equal(applyRanges(t, "k", ranges({ shared: { "Win rate": [0, 100] } })), t);
});

test("clearing a range removes it and leaves no empty entries", () => {
  const t = judgment([quantitative()]);
  const saved = setRange(EMPTY_RANGES, t, "k", 1, [0, 100]);
  assert.deepEqual(setRange(saved, t, "k", 1, null), EMPTY_RANGES);
  const g = judgment([quantitative({ group: "shared:0" })]);
  assert.deepEqual(setRange(setRange(EMPTY_RANGES, g, "k", 1, [0, 100]), g, "k", 1, null), EMPTY_RANGES);
});

test("setting a range on a column that is not a number column changes nothing", () => {
  const t = judgment([quantitative()]);
  assert.equal(setRange(EMPTY_RANGES, t, "k", 7, [0, 100]), EMPTY_RANGES);
});

test("a table's key follows its title and headers, not its rows", () => {
  const table = { id: "t0", title: "Standings", headers: ["Team", "Win rate"], rows: [["A", "25%"]] };
  const key = rangeTableKey(table);
  assert.equal(rangeTableKey({ ...table, id: "t4", rows: [["B", "28%"]] }), key);
  assert.notEqual(rangeTableKey({ ...table, title: "Playoffs" }), key);
  assert.notEqual(rangeTableKey({ ...table, headers: ["Team", "Loss rate"] }), key);
});

test("ranges read from a message keep only well-formed entries", () => {
  assert.deepEqual(
    readRanges({
      shared: { Price: [0, 100], Bad: [3, 1], Text: "0,100", Long: [0, 1, 2] },
      tables: { k: { "Win rate": [0, 100], Nope: [null, 4] }, empty: { Nope: ["a", "b"] }, junk: 7 },
      extra: true,
    }),
    { shared: { Price: [0, 100] }, tables: { k: { "Win rate": [0, 100] } } },
  );
  for (const junk of [null, undefined, 4, "x", [], { shared: 3, tables: [] }]) {
    assert.deepEqual(readRanges(junk), EMPTY_RANGES, JSON.stringify(junk));
  }
});

test("ranges read from a message are capped in count and key length", () => {
  const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`c${i}`, [0, 1]]));
  const read = readRanges({ shared: { ...many, ["x".repeat(500)]: [0, 1] }, tables: { k: many } });
  assert.equal(Object.keys(read.shared).length, RANGE_LIMITS.columns);
  assert.equal(Object.keys(read.tables["k"]!).length, RANGE_LIMITS.columns);
  assert.equal(
    Object.keys(read.shared).every((k) => k.length <= RANGE_LIMITS.keyLength),
    true,
  );
});
