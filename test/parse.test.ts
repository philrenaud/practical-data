import { test } from "node:test";
import assert from "node:assert/strict";
import { isDateLike, isMissing, parseNumber } from "../src/core/parse.ts";

const cases: ReadonlyArray<readonly [string, number | null, string | null, (readonly [number, number])?]> = [
  ["$0.25", 0.25, "$"],
  // Halves, as in games behind.
  ["6½", 6.5, null],
  ["½", 0.5, null],
  ["51½", 51.5, null],
  // Fractions with the fraction slash, as an encyclopedia's fraction template writes them.
  ["8 1\u20442", 8.5, null],
  ["1\u20442", 0.5, null],
  ["22 3\u20444", 22.75, null],
  ["81\u20442", null, null],
  ["$14.00", 14, "$"],
  ["€1,200.50", 1200.5, "€"],
  ["-$3", -3, "$"],
  ["($3.00)", -3, "$"],
  ["45%", 45, "%"],
  ["45.2 %", 45.2, "%"],
  ["0.33x", 0.33, "x"],
  [".312", 0.312, null],
  ["−0.5", -0.5, null],
  ["1,425,671,352", 1425671352, null],
  ["1,234[12]", 1234, null],
  ["≤ 272K", 272000, null],
  ["$1.5B", 1.5e9, "$"],
  ["12 GB", 12, "GB"],
  ["3.2 GHz", 3.2, "GHz"],
  ["2024", 2024, null],
  ["42*", 42, null],
  ["6' 6\"", 78, "in"],
  ["6'0\"", 72, "in"],
  ["5′ 11″", 71, "in"],
  ["6 ft 2 in", 74, "in"],
  ["20-25", 22.5, null, [20, 25]],
  ["26–30", 28, null, [26, 30]],
  ["$10 to $20", 15, "$", [10, 20]],
  ["1.5-2.5 GB", 2, "GB", [1.5, 2.5]],
  ["65+", 65, null],
  ["1M+", 1e6, null],
  ["$500K+", 5e5, "$"],
  ["35-10", null, null],
  ["6-6", null, null],
  ["2024-01", null, null],
  ["2:59", 179, ":"],
  ["3:00", 180, ":"],
  ["0:57", 57, ":"],
  ["1:02:03", 3723, ":"],
  ["1558:44", 93524, ":"],
  ["12345:00", null, null],
  ["1200:1", null, null],
  ["2:61", null, null],
  ["7:05 PM", null, null],
  ["1st", null, null],
  ["3–4", 3.5, null, [3, 4]],
  ["2024-01-02", null, null],
  ["1:23.45", null, null],
  ["GPT-5 mini", null, null],
  ["Not applicable", null, null],
];

for (const [input, value, unit, range] of cases) {
  test(`parseNumber(${JSON.stringify(input)})`, () => {
    const got = parseNumber(input);
    if (value === null) assert.equal(got, null);
    else
      assert.deepEqual(got, { value, unit, bound: input.startsWith("≤") || input.endsWith("+"), range: range ?? null });
  });
}

test("a value followed by the condition it holds under parses to the value", () => {
  assert.deepEqual(parseNumber("$0.10 / MTok for prompts up to 100,000 tokens"), {
    value: 0.1,
    unit: "$",
    bound: false,
    range: null,
  });
  assert.deepEqual(parseNumber("$2 / GB when billed yearly"), { value: 2, unit: "$", bound: false, range: null });
  assert.equal(parseNumber("2 for 4"), null, "a batting line");
  assert.equal(parseNumber("3 for 45"), null, "bowling figures");
  assert.equal(parseNumber("Plan for teams"), null);
});

test("isMissing recognizes placeholders", () => {
  for (const t of ["", "—", "N/A", "Not applicable", " – ", "TBD[3]", "— N/a", "— N/a [p]", "-- n/a --", ".."]) {
    assert.equal(isMissing(t), true, t);
  }
  for (const t of ["0", "$0.00", "None of the above"]) assert.equal(isMissing(t), false, t);
});

test("clock-like durations are numbers; times of day stay dates", () => {
  assert.equal(isDateLike("2:59"), false);
  assert.equal(isDateLike("7:05 PM"), true);
  assert.equal(isDateLike("2024-01-02"), true);
});

test("a unit that names an Object.prototype member is a unit, not a magnitude", () => {
  assert.deepEqual(parseNumber("5 constructor"), { value: 5, unit: "constructor", bound: false, range: null });
});

test("a value followed by a signed change parses as the value", () => {
  assert.deepEqual(parseNumber("740 (-16)"), { value: 740, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("683 (+47)"), { value: 683, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("2.4% (+0.3%)"), { value: 2.4, unit: "%", bound: false, range: null });
  // Without a sign the parenthesis is not a change, and accounting negatives still parse.
  assert.equal(parseNumber("45 (12)"), null);
  assert.equal(parseNumber("Team (+3)"), null);
  assert.deepEqual(parseNumber("($3.00)"), { value: -3, unit: "$", bound: false, range: null });
});
