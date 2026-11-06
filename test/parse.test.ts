import { test } from "node:test";
import assert from "node:assert/strict";
import { conventionForLang, isDateLike, isMissing, parseNumber } from "../src/core/parse.ts";

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
  // A magnitude written once distributes to both ends.
  ["$50–60K", 55000, "$", [50000, 60000]],
  ["$50-60K", 55000, "$", [50000, 60000]],
  ["$50K–$60K", 55000, "$", [50000, 60000]],
  ["50–60K", 55000, null, [50000, 60000]],
  ["€1–2M", 1500000, "€", [1000000, 2000000]],
  ["$1.5–2.5M", 2000000, "$", [1500000, 2500000]],
  ["1–2 million", 1500000, null, [1000000, 2000000]],
  ["3 to 5 bn", 4e9, null, [3e9, 5e9]],
  // The low end keeps its bare reading when distributing would invert the range.
  ["500–1K", 750, null, [500, 1000]],
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
  ["1544:10", 92650, ":"],
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

test("a measurement followed by its conversion to another unit parses as the first value", () => {
  assert.deepEqual(parseNumber("317.7 km/h (197 mph)"), { value: 317.7, unit: "km/h", bound: false, range: null });
  assert.deepEqual(parseNumber("1,021.9 km (635 mi)"), { value: 1021.9, unit: "km", bound: false, range: null });
  assert.deepEqual(parseNumber("29 km (18 mi)[3]"), { value: 29, unit: "km", bound: false, range: null });
  // The parenthesis must hold one amount in a different unit.
  assert.equal(parseNumber("300 km/h (310 km/h with +10 tolerance)"), null);
  assert.equal(parseNumber("120 km (120 km)"), null, "same unit");
  assert.equal(parseNumber("45 votes (12%)"), null, "a share is not a conversion");
  assert.equal(parseNumber("Route 9 (north)"), null);
});

test("a value followed by a note in words parses as the value", () => {
  assert.deepEqual(parseNumber("80 (combined release)"), { value: 80, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("9,633 (combined release)"), { value: 9633, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("1,234 (est.)"), { value: 1234, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("12 km (est.)"), { value: 12, unit: "km", bound: false, range: null });
  assert.deepEqual(parseNumber("20–25 (approx.)"), { value: 22.5, unit: null, bound: false, range: [20, 25] });
  assert.deepEqual(parseNumber("≥ 45 (approx.)"), { value: 45, unit: null, bound: true, range: null });
  // The part before the note must be a number on its own, and a note with a number in it is a second value.
  assert.equal(parseNumber("Route 9 (north)"), null);
  assert.equal(parseNumber("Spring 2005 (lot A)"), null);
  assert.equal(parseNumber("1st (tie)"), null);
  assert.equal(parseNumber("45 (12)"), null);
  assert.equal(parseNumber("45 (about 12)"), null);
  assert.equal(parseNumber("45 (combined release) more"), null);
});

test("a count followed by its share parses as the count", () => {
  assert.deepEqual(parseNumber("1,234 (45.2%)"), { value: 1234, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("22(13.1%)"), { value: 22, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("0 (0%)"), { value: 0, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("4 ( 100% )"), { value: 4, unit: null, bound: false, range: null });
  // The count must be a bare number and the share a percentage of the whole.
  assert.equal(parseNumber("45 votes (12%)"), null, "a count with a unit");
  assert.equal(parseNumber("$40 (12%)"), null, "a price");
  assert.equal(parseNumber("12% (3%)"), null, "a share with a share");
  assert.equal(parseNumber("45 (12)"), null, "no percent sign");
  assert.equal(parseNumber("45 (140%)"), null, "more than the whole");
  assert.equal(parseNumber("≥ 45 (12%)"), null, "a bound");
  assert.equal(parseNumber("Route 9 (12%)"), null);
  assert.deepEqual(
    parseNumber("740 (+16%)"),
    { value: 740, unit: null, bound: false, range: null },
    "a signed change still reads first",
  );
});

test("a document language maps to its number convention", () => {
  assert.equal(conventionForLang("de"), "comma-decimal");
  assert.equal(conventionForLang("de-DE"), "comma-decimal");
  assert.equal(conventionForLang("pt-BR"), "comma-decimal");
  assert.equal(conventionForLang("TR"), "comma-decimal");
  assert.equal(conventionForLang("en"), "dot-decimal");
  assert.equal(conventionForLang("en-GB"), "dot-decimal");
  assert.equal(conventionForLang(""), "dot-decimal");
  assert.equal(conventionForLang(undefined), "dot-decimal");
  // Spanish stays dot-decimal: Spain writes 1.234,56 but Mexico writes 1,234.56.
  assert.equal(conventionForLang("es"), "dot-decimal");
});

test("comma-decimal pages read dots as thousands and commas as decimals", () => {
  const de = (t: string) => parseNumber(t, "comma-decimal");
  assert.deepEqual(de("65.890"), { value: 65890, unit: null, bound: false, range: null });
  assert.deepEqual(de("1.234.567"), { value: 1234567, unit: null, bound: false, range: null });
  assert.deepEqual(de("891,12"), { value: 891.12, unit: null, bound: false, range: null });
  assert.deepEqual(de("12,5 %"), { value: 12.5, unit: "%", bound: false, range: null });
  assert.deepEqual(de("2.962 m"), { value: 2962, unit: "m", bound: false, range: null });
  assert.deepEqual(de("1.299,00 €"), { value: 1299, unit: "€", bound: false, range: null });
  assert.deepEqual(de("1 234,56"), { value: 1234.56, unit: null, bound: false, range: null });
  assert.deepEqual(de("−2,5"), { value: -2.5, unit: null, bound: false, range: null });
  assert.deepEqual(de("(1.234)"), { value: -1234, unit: null, bound: false, range: null }, "an accounting negative");
  assert.deepEqual(
    de("22 (13,1%)"),
    { value: 22, unit: null, bound: false, range: null },
    "count-share follows the convention",
  );
  // A comma decimal means something different in each convention.
  assert.deepEqual(de("1,234"), { value: 1.234, unit: null, bound: false, range: null });
  // Numbers that do not fit the convention stay text instead of misreading.
  assert.equal(de("1.5"), null, "a dot decimal on a comma-decimal page");
  assert.equal(de("1,234,567"), null, "comma thousands on a comma-decimal page");
  assert.equal(de("1.23.4"), null, "groups that are not thousands");
  assert.equal(de("22 (13.1%)"), null, "a dot-decimal share on a comma-decimal page");
  // Untouched forms still read.
  assert.deepEqual(de("1544:10"), { value: 92650, unit: ":", bound: false, range: null });
  assert.equal(de("15. März 2024"), null);
});

test("the default convention is unchanged English behavior", () => {
  assert.deepEqual(parseNumber("65.890"), { value: 65.89, unit: null, bound: false, range: null });
  assert.deepEqual(parseNumber("1,234.56"), { value: 1234.56, unit: null, bound: false, range: null });
  assert.equal(parseNumber("891,12"), null);
  assert.equal(parseNumber("22 (13,1%)"), null, "a comma-decimal share on an English page");
});

test("a trailing currency symbol is the unit in both conventions", () => {
  assert.deepEqual(parseNumber("40 €"), { value: 40, unit: "€", bound: false, range: null });
  assert.deepEqual(parseNumber("40€"), { value: 40, unit: "€", bound: false, range: null });
  assert.deepEqual(parseNumber("1,299.00 $"), { value: 1299, unit: "$", bound: false, range: null });
  assert.deepEqual(parseNumber("1.299,00 €", "comma-decimal"), { value: 1299, unit: "€", bound: false, range: null });
  assert.deepEqual(parseNumber("12 £"), { value: 12, unit: "£", bound: false, range: null });
});

test("a value followed by the value that replaces it later parses as the first value", () => {
  const dollars = (value: number) => ({ value, unit: "$", bound: false, range: null });
  assert.deepEqual(parseNumber("$52, or $58 after year one"), dollars(52));
  assert.deepEqual(parseNumber("$61.25, then $122.50 from March 1, 2027"), dollars(61.25));
  assert.deepEqual(parseNumber("$12, or $15"), dollars(12));
  assert.deepEqual(parseNumber("4 GB, then 8 GB after the upgrade"), {
    value: 4,
    unit: "GB",
    bound: false,
    range: null,
  });
  // Both values need the same unit, and only ", or" and ", then" join them.
  assert.equal(parseNumber("3, or 4"), null, "bare numbers");
  assert.equal(parseNumber("$40, or 12%"), null, "different units");
  assert.equal(parseNumber("$40, and $50"), null);
  assert.equal(parseNumber("$40, or $50 plus tax"), null, "a tail that is not a condition");
  assert.equal(parseNumber("Free, or $5 with support"), null);
});
