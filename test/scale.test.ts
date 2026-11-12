import { test } from "node:test";
import assert from "node:assert/strict";
import { divergingColor, isPaletteId, PALETTES, type PaletteId } from "../src/core/palettes.ts";
import { isTemperature, legendStops, positions, schemeColor } from "../src/core/scale.ts";
import type { ColumnEncoding } from "../src/core/types.ts";

const evidence = {
  comparable: 1,
  polarity: { higher_is_better: 0, lower_is_better: 1, neutral: 0 },
  log: null,
  orderConfidence: null,
};

const price = (transform: "linear" | "log"): ColumnEncoding => ({
  kind: "quantitative",
  col: 1,
  header: "Input",
  polarity: "lower_is_better",
  transform,
  unit: "$",
  domain: [0.1, 10],
  values: [0.1, 1, 10, null],
  group: null,
  evidence,
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
    kind: "ordinal",
    col: 2,
    header: "Category",
    polarity: "neutral",
    order: ["lightweight", "versatile", "powerful"],
    labels: ["Lightweight", "Versatile", "Powerful"],
    values: ["powerful", "lightweight", "versatile", null],
    group: null,
    evidence,
  };
  assert.deepEqual(positions(e), [1, 0, 0.5, null]);
});

test("every palette has full-strength ends, and fading ramps leave the middle plain", () => {
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

test("isPaletteId accepts palette names only", () => {
  assert.equal(isPaletteId("calm"), true);
  assert.equal(isPaletteId("constructor"), false);
  assert.equal(isPaletteId("toString"), false);
});

const temperature = (header: string, unit: string | null, domain: [number, number]): ColumnEncoding => ({
  kind: "quantitative",
  col: 2,
  header,
  polarity: "neutral",
  transform: "linear",
  unit,
  domain,
  values: [domain[0], domain[1]],
  group: null,
  evidence: { ...evidence, polarity: { higher_is_better: 0.3, lower_is_better: 0.05, neutral: 0.65 } },
});

/** Red minus blue of a hex or rgb() color: positive is warm, negative is cool. */
const warmth = (color: string): number => {
  const rgb = color.startsWith("#")
    ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
    : color.match(/\d+/g)!.map(Number);
  return rgb[0]! - rgb[2]!;
};

test("a neutral temperature column runs from blue (coldest) to red (warmest)", () => {
  for (const e of [
    temperature("Temp.", "°", [2, 5]),
    temperature("High", "°C", [-4, 12]),
    temperature("Low", "°F", [20, 61]),
  ]) {
    assert.equal(isTemperature(e), true, e.header);
    assert.ok(warmth(schemeColor(e, "calm", 0, false).color) < 0, `${e.header} cold end`);
    assert.ok(warmth(schemeColor(e, "calm", 1, false).color) > 0, `${e.header} warm end`);
    assert.ok(warmth(schemeColor(e, "calm", 0, true).color) < 0, `${e.header} cold end, dark`);
    assert.ok(warmth(schemeColor(e, "calm", 1, true).color) > 0, `${e.header} warm end, dark`);
    assert.equal(schemeColor(e, "calm", 0.5, true).weight, 0);
  }
});

test("degrees that are angles, and temperatures with a better end, keep their schemes", () => {
  // Bearings in bare degrees: the header names a direction, or the values run past 140.
  assert.equal(isTemperature(temperature("Wind dir", "°", [10, 120])), false);
  assert.equal(isTemperature(temperature("Bearing", "°", [0, 90])), false);
  assert.equal(isTemperature(temperature("Lat", "°", [40.1, 44.9])), false);
  assert.equal(isTemperature(temperature("Heading", "°", [5, 350])), false);
  assert.equal(isTemperature(temperature("Course", "°", [5, 350])), false);
  assert.equal(isTemperature(temperature("Reading", "°", [15, 350])), false);
  // Not degrees at all.
  assert.equal(isTemperature(temperature("Height", "m", [2, 5])), false);
  assert.equal(isTemperature(temperature("Count", null, [2, 5])), false);
  // A temperature the model judged to have a better end stays diverging.
  const pool = { ...temperature("Water", "°C", [18, 26]), polarity: "higher_is_better" } as ColumnEncoding;
  assert.equal(isTemperature(pool), false);
  // A neutral non-temperature column keeps yellow to blue.
  const height = temperature("Height", "m", [2, 5]);
  assert.ok(warmth(schemeColor(height, "calm", 1, false).color) < 0);
});

test("a temperature legend reads cold to warm", () => {
  const stops = legendStops(temperature("Temp.", "°", [2, 5]), "calm");
  assert.ok(warmth(stops[0]!) < 0 && warmth(stops.at(-1)!) > 0);
  const dark = legendStops(temperature("Temp.", "°", [2, 5]), "calm", true, "#3a3840");
  assert.ok(warmth(dark[0]!) < 0 && warmth(dark.at(-1)!) > 0);
});
