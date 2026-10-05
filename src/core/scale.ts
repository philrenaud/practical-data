/**
 * Encoding → position → color. Pure; the DOM painter supplies each cell's
 * background and blends the result over it.
 *
 * Scheme choice:
 *  - Quantitative with a preferred direction: a diverging palette (see
 *    palettes.ts), oriented so the good end is always the "good" color.
 *  - Quantitative with no preferred direction: sequential yellow→green→blue,
 *    since red/green would imply a judgment the data doesn't carry.
 *  - Ordinal labels: sequential purple. Order is certain; "better" usually is not.
 *
 * On dark backgrounds the sequential and ordinal scales ramp from the
 * background toward their hue, so the lowest value recedes instead of glowing.
 */
import { scaleSequential, scaleSequentialLog } from "d3-scale";
import { interpolatePurples, interpolateYlGnBu } from "d3-scale-chromatic";
import { divergingColor, divergingStops, type PaletteId } from "./palettes.ts";
import type { ColumnEncoding } from "./types.ts";

export type { PaletteId as Palette } from "./palettes.ts";

type Interpolator = (t: number) => string;

/** Keeps sequential schemes off their near-white and near-black ends. */
const clampRange =
  (interp: Interpolator, lo: number, hi: number): Interpolator =>
  (t) =>
    interp(lo + (hi - lo) * Math.min(1, Math.max(0, t)));

const SEQUENTIAL = clampRange(interpolateYlGnBu, 0.08, 0.72);
const ORDINAL = clampRange(interpolatePurples, 0.18, 0.78);

/** Normalizer from value to 0–1 using D3's linear or log scale. */
const normalizer = (e: Extract<ColumnEncoding, { kind: "quantitative" }>): ((v: number) => number) => {
  const [lo, hi] = e.domain;
  if (lo === hi) return () => 0.5;
  const scale =
    e.transform === "log" && lo > 0
      ? scaleSequentialLog((t) => t).domain([lo, hi]).clamp(true)
      : scaleSequential((t) => t).domain([lo, hi]).clamp(true);
  return (v) => scale(v);
};

/**
 * Position of every data row on the column's scale, 0–1, after polarity: 1 is
 * always "better" (or "more", when there is no better). Null where the cell is
 * missing or excluded.
 */
export const positions = (e: ColumnEncoding, excludedRows: ReadonlySet<number> = new Set()): (number | null)[] => {
  if (e.kind === "ordinal") {
    const last = Math.max(1, e.order.length - 1);
    const index = new Map(e.order.map((label, i) => [label, i / last]));
    return e.values.map((v, row) => (v === null || excludedRows.has(row) ? null : (index.get(v) ?? null)));
  }
  const norm = normalizer(e);
  return e.values.map((v, row) => {
    if (v === null || excludedRows.has(row)) return null;
    const raw = norm(v);
    return e.polarity === "lower_is_better" ? 1 - raw : raw;
  });
};

/** The tint for position `t`, and how strongly to apply it (0–1). */
export const schemeColor = (
  e: ColumnEncoding,
  palette: PaletteId,
  t: number,
  dark: boolean,
): { color: string; weight: number } => {
  const single = e.kind === "ordinal" ? ORDINAL : e.polarity === "neutral" ? SEQUENTIAL : null;
  if (single === null) return divergingColor(palette, t, dark);
  return dark ? { color: single(1), weight: 0.2 + 0.8 * t } : { color: single(t), weight: 1 };
};

/** Gradient stops for legends, low value → high value (pre-polarity). */
export const legendStops = (e: ColumnEncoding, palette: PaletteId, dark = false, mid = "#e9e6df", n = 9): string[] => {
  if (e.kind === "ordinal") return Array.from({ length: n }, (_, i) => ORDINAL(i / (n - 1)));
  if (e.polarity === "neutral") return Array.from({ length: n }, (_, i) => SEQUENTIAL(i / (n - 1)));
  const stops = divergingStops(palette, dark, mid, n);
  return e.polarity === "lower_is_better" ? stops.reverse() : stops;
};
