import { test } from "node:test";
import assert from "node:assert/strict";
import { divergingColor, PALETTES, type PaletteId } from "../src/core/palettes.ts";
import { positions, schemeColor } from "../src/core/scale.ts";
import type { ColumnEncoding } from "../src/core/types.ts";

const evidence = { comparable: 1, polarity: { higher_is_better: 0, lower_is_better: 1, neutral: 0 }, log: null, orderConfidence: null };

const price = (transform: "linear" | "log"): ColumnEncoding => ({
  kind: "quantitative", col: 1, header: "Input", polarity: "lower_is_better", transform, unit: "$",
  domain: [0.1, 10], values: [0.1, 1, 10, null], group: null, evidence,
});

test("lower-is-better puts the cheapest row at t=1 (the good end)", () => {
  const [cheap, mid, dear, missing] = positions(price("linear"));
  assert.equal(cheap, 1);
  assert.equal(dear, 0);
  assert.equal(missing, null);
  assert.ok(Math.abs(mid! - (1 - 0.9 / 9.9)) < 1e-9);
});

test("log transform centers the geometric midpoint", () => {
  assert.ok(Math.abs(positions(price("log"))[1]! - 0.5) < 1e-9);
});

test("excluded aggregate rows get no position", () => {
  assert.equal(positions(price("linear"), new Set([0]))[0], null);
});

test("ordinal levels spread evenly from 0 to 1", () => {
  const e: ColumnEncoding = {
    kind: "ordinal", col: 2, header: "Category", polarity: "neutral",
    order: ["lightweight", "versatile", "powerful"], labels: ["Lightweight", "Versatile", "Powerful"],
    values: ["powerful", "lightweight", "versatile", null], group: null, evidence,
  };
  assert.deepEqual(positions(e), [1, 0, 0.5, null]);
});

test("every palette: the ends are full strength, and fading ramps leave the middle plain", () => {
  for (const id of Object.keys(PALETTES) as PaletteId[]) {
    for (const dark of [false, true]) {
      const ramp = dark ? PALETTES[id].dark : PALETTES[id].light;
      assert.equal(divergingColor(id, 0, dark).weight, 1, `${id} ${dark}`);
      assert.equal(divergingColor(id, 1, dark).weight, 1, `${id} ${dark}`);
      assert.equal(divergingColor(id, 0.5, dark).weight, ramp.fade ? 0 : 1, `${id} ${dark}`);
    }
  }
});

test("on dark pages, single-hue scales ramp up from the background", () => {
  const e = price("linear");
  const neutral: ColumnEncoding = { ...e, polarity: "neutral" } as ColumnEncoding;
  assert.ok(schemeColor(neutral, "calm", 0, true).weight < schemeColor(neutral, "calm", 1, true).weight);
  assert.equal(schemeColor(neutral, "calm", 0, false).weight, 1);
});
