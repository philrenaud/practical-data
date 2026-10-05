import { test } from "node:test";
import assert from "node:assert/strict";
import { transposeSnapshot } from "../src/core/orient.ts";

test("transposes a benchmark table so each benchmark becomes a column", () => {
  const t = transposeSnapshot({
    id: "t0",
    title: "Benchmarks",
    headers: ["Benchmark", "Clef", "Jev", "Laya"],
    rows: [
      ["BFCL", "98.47", "95.75", "38.13"],
      ["ToolRet", "69.19", "65.28", "12.69"],
    ],
  });
  assert.deepEqual(t, {
    id: "t0",
    title: "Benchmarks",
    headers: ["Benchmark", "BFCL", "ToolRet"],
    rows: [
      ["Clef", "98.47", "69.19"],
      ["Jev", "95.75", "65.28"],
      ["Laya", "38.13", "12.69"],
    ],
  });
});
