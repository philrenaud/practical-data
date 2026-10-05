import { test } from "node:test";
import assert from "node:assert/strict";
import { describeColumn } from "../src/core/legend.ts";
import type { ColumnEncoding } from "../src/core/types.ts";

const evidence = { comparable: 0.98, polarity: { higher_is_better: 0, lower_is_better: 0.98, neutral: 0 }, log: 1, orderConfidence: 0.98 };

test("a shared, log-scaled price column", () => {
  const e: ColumnEncoding = {
    kind: "quantitative", col: 2, header: "Cached input", polarity: "lower_is_better", transform: "log", unit: "$",
    domain: [0.01, 2], values: [], group: "shared:1", evidence,
  };
  const { status, lo, hi, facts } = describeColumn(e, "calm", false, { sharedWith: 3, aggregates: [] });
  assert.deepEqual({ status, lo, hi, facts }, {
    status: "Lower is better · Log scale",
    lo: "$0.01",
    hi: "$2",
    facts: ["200× range", "Found in 3 tables"],
  });
});

test("a linear column that excludes a totals row", () => {
  const e: ColumnEncoding = {
    kind: "quantitative", col: 1, header: "Population", polarity: "neutral", transform: "linear", unit: null,
    domain: [35, 1.4e9], values: [], group: null, evidence,
  };
  const { status, facts } = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: ["World"] });
  assert.deepEqual({ status, facts }, { status: "No better direction · Linear scale", facts: ["Excludes total: World"] });
});

test("ranked categories show their first and last level as extents", () => {
  const e: ColumnEncoding = {
    kind: "ordinal", col: 1, header: "Category", polarity: "neutral", order: ["lightweight", "versatile", "powerful"],
    labels: ["Lightweight", "Versatile", "Powerful"], values: [], group: null, evidence,
  };
  const { status, lo, hi, facts } = describeColumn(e, "calm", false, { sharedWith: 1, aggregates: [] });
  assert.deepEqual({ status, lo, hi, facts }, { status: "Ranked categories · 3 levels", lo: "Lightweight", hi: "Powerful", facts: [] });
});

test("duration extents read back as clock values", async () => {
  const { withUnit } = await import("../src/core/legend.ts");
  assert.equal(withUnit(179, ":"), "2:59");
  assert.equal(withUnit(185, ":"), "3:05");
  assert.equal(withUnit(3723, ":"), "1:02:03");
});
