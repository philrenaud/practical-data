import { test } from "node:test";
import assert from "node:assert/strict";
import { toCSV } from "../src/core/tabular.ts";

test("CSV quotes fields with commas, quotes, and line breaks", () => {
  const csv = toCSV(
    ["Company", "Raised", "Note"],
    [
      ["Nimbus Systems", "$1.5B", 'says "all in"'],
      ["Quellstack, Inc.", "$720M", "two\nlines"],
    ],
  );
  assert.equal(
    csv,
    "Company,Raised,Note\r\n" + 'Nimbus Systems,$1.5B,"says ""all in"""\r\n' + '"Quellstack, Inc.",$720M,"two\nlines"',
  );
});

test("CSV leaves plain fields unquoted", () => {
  assert.equal(toCSV(["A", "B"], [["1", "2"]]), "A,B\r\n1,2");
});
