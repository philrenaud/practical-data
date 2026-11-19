import { test } from "node:test";
import assert from "node:assert/strict";
import { describeColumn, withUnit } from "../src/core/legend.ts";
import type { ColumnEncoding } from "../src/core/types.ts";

const evidence = {
  comparable: 0.98,
  polarity: { higher_is_better: 0, lower_is_better: 0.98, neutral: 0 },
  log: 1,
  orderConfidence: 0.98,
};

test("a shared, log-scaled price column", () => {
  const e: ColumnEncoding = {
    kind: "quantitative",
    col: 2,
    header: "Cached input",
    polarity: "lower_is_better",
    transform: "log",
    unit: "$",
    domain: [0.01, 2],
    values: [],
    group: "shared:1",
    evidence,
  };
  const { status, lo, hi, facts } = describeColumn(e, "calm", false, { sharedWith: 3, aggregates: [] });
  assert.deepEqual(
    { status, lo, hi, facts },
    {
      status: "Lower is better · Log scale",
      lo: "$0.01",
      hi: "$2",
      facts: ["200× range", "Found in 3 tables"],
    },
  );
});

test("a linear column that excludes a totals row", () => {
  const e: ColumnEncoding = {
    kind: "quantitative",
    col: 1,
    header: "Population",
    polarity: "neutral",
    transform: "linear",
    unit: null,
    domain: [35, 1.4e9],
    values: [],
    group: null,
    evidence,
  };
  const { status, facts } = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: ["World"] });
  assert.deepEqual(
    { status, facts },
    { status: "No better direction · Linear scale", facts: ["Excludes total: World"] },
  );
});

test("ranked categories show their first and last level as extents", () => {
  const e: ColumnEncoding = {
    kind: "ordinal",
    col: 1,
    header: "Category",
    polarity: "neutral",
    order: ["lightweight", "versatile", "powerful"],
    labels: ["Lightweight", "Versatile", "Powerful"],
    values: [],
    group: null,
    evidence,
  };
  const { status, lo, hi, facts } = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: [] });
  assert.deepEqual(
    { status, lo, hi, facts },
    { status: "Ranked categories · 3 levels", lo: "Lightweight", hi: "Powerful", facts: [] },
  );
});

test("duration extents read back as clock values", () => {
  assert.equal(withUnit(179, ":"), "2:59");
  assert.equal(withUnit(185, ":"), "3:05");
  assert.equal(withUnit(3723, ":"), "1:02:03");
  assert.equal(withUnit(6, "streak"), "W6");
  assert.equal(withUnit(-5, "streak"), "L5");
});

test("a date column reads as dates, earliest to latest", () => {
  const e: ColumnEncoding = {
    kind: "quantitative",
    col: 0,
    header: "Released",
    polarity: "neutral",
    transform: "linear",
    unit: "month",
    domain: [Date.UTC(1993, 11, 1), Date.UTC(2001, 5, 1)],
    values: [],
    group: null,
    evidence: {
      comparable: 1,
      polarity: { higher_is_better: 0, lower_is_better: 0, neutral: 1 },
      log: null,
      orderConfidence: null,
    },
  };
  const { status, lo, hi } = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: [] });
  assert.deepEqual({ status, lo, hi }, { status: "Dates · Earliest to latest", lo: "Dec 1993", hi: "Jun 2001" });
});

test("a column of times without dates reads as times", () => {
  const MONDAY = 4 * 86_400_000;
  const e: ColumnEncoding = {
    kind: "quantitative",
    col: 0,
    header: "Kickoff",
    polarity: "neutral",
    transform: "linear",
    unit: "weektime",
    domain: [MONDAY + 3 * 86_400_000 + 20.25 * 3_600_000, MONDAY + 7 * 86_400_000 + 20.25 * 3_600_000],
    values: [],
    group: null,
    evidence: {
      comparable: 1,
      polarity: { higher_is_better: 0, lower_is_better: 0, neutral: 1 },
      log: null,
      orderConfidence: null,
    },
  };
  const { status, lo, hi } = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: [] });
  assert.deepEqual({ status, lo, hi }, { status: "Times · Earliest to latest", lo: "Thu 8:15 PM", hi: "Mon 8:15 PM" });
});

test("a neutral temperature column reads cold to warm", () => {
  const e: ColumnEncoding = {
    kind: "quantitative",
    col: 2,
    header: "Temp.",
    polarity: "neutral",
    transform: "linear",
    unit: "°",
    domain: [2, 5],
    values: [],
    group: null,
    evidence,
  };
  const { status, lo, hi } = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: [] });
  assert.deepEqual({ status, lo, hi }, { status: "Cold to warm · Linear scale", lo: "2 °", hi: "5 °" });
});

const percent = (over: Partial<Extract<ColumnEncoding, { kind: "quantitative" }>> = {}): ColumnEncoding => ({
  kind: "quantitative",
  col: 1,
  header: "Win rate",
  polarity: "higher_is_better",
  transform: "linear",
  unit: "%",
  domain: [25, 28],
  values: [25, 28],
  group: null,
  evidence,
  ...over,
});

const rangeOf = (e: ColumnEncoding) => describeColumn(e, "calm", false, { sharedWith: 1, aggregates: [] }).range;

test("a number column offers its range for editing, with presets that would change it", () => {
  assert.deepEqual(rangeOf(percent()), {
    lo: 25,
    hi: 28,
    unit: "%",
    fit: [25, 28],
    track: { min: 0, max: 100, log: false },
    custom: false,
    presets: [
      { label: "From zero", range: [0, 28] },
      { label: "0 to 100", range: [0, 100] },
    ],
  });
});

test("a custom range is named, and Fit to data puts the fitted range back", () => {
  const e = percent({ domain: [0, 100], fit: [25, 28] });
  const legend = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: [] });
  assert.deepEqual(legend.range, {
    lo: 0,
    hi: 100,
    unit: "%",
    fit: [25, 28],
    track: { min: 0, max: 100, log: false },
    custom: true,
    presets: [
      { label: "Fit to data", range: null },
      { label: "From zero", range: [0, 28] },
    ],
  });
  assert.equal(legend.lo, "0%");
  assert.equal(legend.hi, "100%");
  assert.deepEqual(legend.facts, ["Custom range · Data 25% to 28%"]);
});

test("presets leave out what the data does not allow", () => {
  // Values past 100% rule out 0 to 100.
  assert.deepEqual(
    rangeOf(percent({ domain: [80, 140] }))?.presets.map((p) => p.label),
    ["From zero"],
  );
  // A scale that already starts at zero has nothing to add.
  assert.deepEqual(rangeOf(percent({ unit: "$", domain: [0, 40] }))?.presets, []);
  // All-negative values run up to zero.
  assert.deepEqual(rangeOf(percent({ unit: null, domain: [-9, -2] }))?.presets, [{ label: "To zero", range: [-9, 0] }]);
  // Values on both sides of zero have no zero end to add.
  assert.deepEqual(rangeOf(percent({ unit: null, domain: [-9, 4] }))?.presets, []);
  // A log scale can't start at zero.
  assert.deepEqual(rangeOf(percent({ unit: "$", transform: "log", domain: [2, 2000] }))?.presets, []);
});

test("dates, clock times, streaks and ranked labels have no range to edit", () => {
  assert.equal(rangeOf(percent({ unit: ":", domain: [120, 190] })), null);
  assert.equal(rangeOf(percent({ unit: "streak", domain: [-3, 5] })), null);
  assert.equal(rangeOf(percent({ unit: "date", domain: [1.7e12, 1.8e12] })), null);
  const ordinal: ColumnEncoding = {
    kind: "ordinal",
    col: 1,
    header: "Tier",
    polarity: "neutral",
    order: ["low", "high"],
    labels: ["Low", "High"],
    values: ["low", "high"],
    group: null,
    evidence,
  };
  assert.equal(rangeOf(ordinal), null);
});

test("a column of percentages written without the sign still offers 0 to 100", () => {
  const presets = (header: string) => rangeOf(percent({ unit: null, header }))?.presets.map((p) => p.label);
  assert.deepEqual(presets("Win %"), ["From zero", "0 to 100"]);
  assert.deepEqual(presets("Percent of total"), ["From zero", "0 to 100"]);
  assert.deepEqual(presets("FG pct"), ["From zero", "0 to 100"]);
  assert.deepEqual(presets("Wins"), ["From zero"]);
});
