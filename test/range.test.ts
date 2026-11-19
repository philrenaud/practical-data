import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateJudgment } from "../src/core/isolate.ts";
import {
  applyRanges,
  EMPTY_RANGES,
  RANGE_LIMITS,
  rangeTableKey,
  rangeTrack,
  readRanges,
  setRange,
  trackPosition,
  trackValue,
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

test("a slider track leaves room on both sides of the data", () => {
  const linear = { log: false, percent: false };
  // Data above zero: the track starts at zero and runs as far past the top as the top is from zero.
  assert.deepEqual(rangeTrack([25, 28], [25, 28], linear), { min: 0, max: 56, log: false });
  assert.deepEqual(rangeTrack([39, 249], [39, 249], linear), { min: 0, max: 498, log: false });
  // A percent column within 0 to 100 gets exactly that.
  assert.deepEqual(rangeTrack([25, 28], [25, 28], { log: false, percent: true }), { min: 0, max: 100, log: false });
  assert.deepEqual(rangeTrack([80, 140], [80, 140], { log: false, percent: true }), { min: 0, max: 280, log: false });
  // Data on both sides of zero: one more span each way.
  assert.deepEqual(rangeTrack([-9, 4], [-9, 4], linear), { min: -22, max: 17, log: false });
  // Data below zero mirrors data above it.
  assert.deepEqual(rangeTrack([-9, -2], [-9, -2], linear), { min: -18, max: 0, log: false });
  // A single value still gets a track.
  assert.deepEqual(rangeTrack([5, 5], [5, 5], linear), { min: 0, max: 10, log: false });
});

test("a slider track stretches to hold a range set beyond it", () => {
  assert.deepEqual(rangeTrack([25, 28], [-10, 500], { log: false, percent: false }), {
    min: -10,
    max: 500,
    log: false,
  });
});

test("on a log track the data sits in the middle half", () => {
  const track = rangeTrack([2, 2000], [2, 2000], { log: true, percent: false });
  assert.equal(track.log, true);
  assert.ok(Math.abs(trackPosition(track, 2) - 0.25) < 1e-9);
  assert.ok(Math.abs(trackPosition(track, 2000) - 0.75) < 1e-9);
  assert.ok(Math.abs(trackPosition(track, 63.2455532) - 0.5) < 1e-6);
});

test("positions on a track are clamped to its ends", () => {
  const track = { min: 0, max: 56, log: false };
  assert.equal(trackPosition(track, -5), 0);
  assert.equal(trackPosition(track, 28), 0.5);
  assert.equal(trackPosition(track, 99), 1);
});

test("a slider position reads as a round value", () => {
  const track = { min: 0, max: 56, log: false };
  assert.equal(trackValue(track, 0), 0);
  assert.equal(trackValue(track, 1), 56);
  // 16.8 on a track whose step is 0.5.
  assert.equal(trackValue(track, 0.3), 17);
  const log = rangeTrack([2, 2000], [2, 2000], { log: true, percent: false });
  // Two significant digits on a log track.
  assert.equal(trackValue(log, 0.5), 63);
});

test("a slider position near a marked value lands on it", () => {
  const track = { min: 0, max: 56, log: false };
  // 25.3 is close enough to the data's low end to mean it.
  assert.equal(trackValue(track, 25.3 / 56, [25, 28]), 25);
  assert.equal(trackValue(track, 26.5 / 56, [25, 28]), 26.5);
});
