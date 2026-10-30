import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSpread, profileTable } from "../src/core/profile.ts";

const table = {
  id: "t0",
  title: "Pricing",
  headers: ["Model", "Category", "Rank", "Year", "Cached input", "Notes"],
  rows: [
    ["A", "Lightweight", "1", "2023", "$0.025", "fast and cheap for most tasks"],
    ["B", "Powerful", "2", "2024", "$0.50", "slow but very capable model"],
    ["C", "Versatile", "3", "2024", "Not applicable", "a balanced middle ground"],
    ["D", "Versatile", "4", "2025", "$2.50", "newest model in the lineup"],
    ["E", "Lightweight", "5", "2025", "$0.10", "small and efficient model"],
  ],
};

test("profiles each column by kind", () => {
  const p = profileTable(table);
  // Short lists of unique values stay candidates, because they can be full rankings. The model rejects names and notes.
  assert.deepEqual(
    p.map((c) => c.kind),
    ["categorical", "categorical", "numeric", "numeric", "numeric", "categorical"],
  );
});

test("numeric profile reports spread, unit, rank and year hints", () => {
  const [, , rank, year, price] = profileTable(table);
  assert.ok(rank?.kind === "numeric" && rank.isSequence);
  assert.ok(year?.kind === "numeric" && year.looksLikeYears);
  assert.ok(price?.kind === "numeric");
  assert.equal(price.unit, "$");
  assert.deepEqual(price.values, [0.025, 0.5, null, 2.5, 0.1]);
  assert.equal(describeSpread(price), "values span about 2 orders of magnitude (largest is ~100 times the smallest)");
});

test("categorical profile keeps first-seen level order and display text", () => {
  const cat = profileTable(table)[1];
  assert.ok(cat?.kind === "categorical");
  assert.deepEqual(cat.levels, ["lightweight", "powerful", "versatile"]);
  assert.equal(cat.display["powerful"], "Powerful");
});

test("timestamps and dates are not offered as categories or numbers", () => {
  const events = {
    id: "t1",
    title: "Recent events",
    headers: ["Time", "Day", "Type"],
    rows: [
      ["Sep 29, '26 19:07:16 -0400", "2026-09-29", "Started"],
      ["Sep 29, '26 19:06:59 -0400", "2026-09-29", "Task Setup"],
      ["Sep 22, '26 20:46:03 -0400", "2026-09-22", "Started"],
      ["Sep 22, '26 20:45:48 -0400", "2026-09-22", "Received"],
    ],
  };
  const [time, day, type] = profileTable(events);
  assert.deepEqual([time?.kind, day?.kind, type?.kind], ["text", "text", "categorical"]);
  assert.equal(time?.kind === "text" && time.reason, "dates or times");
});

test("labels that name Object.prototype members are levels like any other", () => {
  const p = profileTable({
    id: "t0",
    title: null,
    headers: ["Role"],
    rows: [["Driver"], ["Constructor"], ["__proto__"], ["Driver"], ["Constructor"]],
  });
  assert.equal(p[0]?.kind, "categorical");
  if (p[0]?.kind !== "categorical") return;
  assert.deepEqual(p[0].levels, ["driver", "constructor", "__proto__"]);
  assert.deepEqual(
    p[0].display,
    Object.fromEntries([
      ["driver", "Driver"],
      ["constructor", "Constructor"],
      ["__proto__", "__proto__"],
    ]),
  );
});

test("a win/loss streak column reads as wins minus losses", () => {
  const [, before, after, liters] = profileTable({
    id: "t0",
    title: "Standings",
    headers: ["Team", "Strk", "Streak", "Tank"],
    rows: [
      ["A", "1W", "W6", "5L"],
      ["B", "5L", "W2", "3L"],
      ["C", "2W", "L1", "8L"],
      ["D", "1L", "", "4L"],
    ],
  });
  assert.ok(before?.kind === "numeric" && after?.kind === "numeric");
  assert.deepEqual(before.values, [1, -5, 2, -1]);
  assert.equal(before.unit, "streak");
  assert.deepEqual(after.values, [6, 2, -1, null]);
  assert.deepEqual(after.samples, ["L1", "W2", "W6"]);
  // Only L, and no streak header: liters, not losses.
  assert.ok(liters?.kind === "numeric");
  assert.deepEqual(liters.values, [5, 3, 8, 4]);
  assert.equal(liters.unit, "L");
});

test("a value with its rank in parentheses reads as the value when the ranks follow the values", () => {
  const [, rate, animals] = profileTable({
    id: "t0",
    title: "Win rates",
    headers: ["Team", "Rate", "Animals"],
    rows: [
      ["A", "52% (3)", "42 (6)"],
      ["B", "61% (1)", "35 (11)"],
      ["C", "44% (5)", "28 (2)"],
      ["D", "52% (2)", "51 (9)"],
      ["E", "48% (4)", "19 (4)"],
    ],
  });
