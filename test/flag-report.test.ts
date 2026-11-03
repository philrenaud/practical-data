import { test } from "node:test";
import assert from "node:assert/strict";
import { readFlag } from "../src/api/flag.ts";
import type { TableSnapshot } from "../src/core/types.ts";
import { buildFlagReport } from "../src/ext/flag-report.ts";

const snapshot: TableSnapshot = {
  id: "t0",
  title: "Invented gadgets",
  headers: ["Gadget", "Mass", "Rating"],
  rows: [
    ["Sprocket", "12 kg", "4.5"],
    ["Flywheel", "7 kg", "3.9"],
  ],
};
const page = { url: "https://gadgets.example/list", title: "Gadget list", lang: "en" };

test("a small table becomes the report whole, and the server accepts it", () => {
  const report = buildFlagReport(snapshot, page, "shaded", "1.2.0", "The Mass column looks off.");
  assert.deepEqual(report, {
    url: "https://gadgets.example/list",
    pageTitle: "Gadget list",
    pageLang: "en",
    kind: "shaded",
    table: {
      title: "Invented gadgets",
      headers: ["Gadget", "Mass", "Rating"],
      rows: [
        ["Sprocket", "12 kg", "4.5"],
        ["Flywheel", "7 kg", "3.9"],
      ],
    },
    note: "The Mass column looks off.",
    build: "1.2.0",
  });
  assert.deepEqual(readFlag(JSON.parse(JSON.stringify(report))), report);
});

test("keeps the first five rows and thirty columns", () => {
  const wide: TableSnapshot = {
    id: "t1",
    title: null,
    headers: Array.from({ length: 40 }, (_, i) => `h${i}`),
    rows: Array.from({ length: 8 }, (_, i) => Array.from({ length: 40 }, (_, j) => `r${i}c${j}`)),
  };
  const report = buildFlagReport(wide, page, "unshaded", "1.2.0");
  assert.equal(report.table.headers.length, 30);
  assert.equal(report.table.rows.length, 5);
  assert.deepEqual(
    report.table.rows.map((r) => r.length),
    [30, 30, 30, 30, 30],
  );
  assert.equal(report.table.rows[4]![29], "r4c29");
  assert.equal("error" in readFlag(JSON.parse(JSON.stringify(report))), false);
});

test("cuts a long cell at 200 characters with an ellipsis", () => {
  const long: TableSnapshot = {
    id: "t2",
    title: "t".repeat(300),
    headers: ["h".repeat(300), "b"],
    rows: [["c".repeat(300), "short"]],
  };
  const { table } = buildFlagReport(long, page, "shaded", "1.2.0");
  for (const s of [table.title!, table.headers[0]!, table.rows[0]![0]!]) {
    assert.equal(s.length, 200);
    assert.equal(s.endsWith("…"), true);
  }
  assert.equal(table.rows[0]![1], "short");
});

test("omits an unticked url and a blank note, and names an untitled page", () => {
  const report = buildFlagReport(snapshot, { url: null, title: "" }, "shaded", "1.2.0", "   ");
  assert.equal("url" in report, false);
  assert.equal("note" in report, false);
  assert.equal("pageLang" in report, false);
  assert.equal(report.pageTitle, "(untitled)");
  assert.equal("error" in readFlag(JSON.parse(JSON.stringify(report))), false);
});
