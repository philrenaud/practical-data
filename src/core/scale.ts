/**
 * Maps each value of an encoding to a position on its scale, and each
 * position to a color. The DOM painter supplies each cell's background and
 * blends the color over it.
 *
 * Schemes:
 *  - Quantitative with a preferred direction: a diverging palette (see
 *    palettes.ts), oriented so the good end is always the "good" color.
 *  - Quantitative with no preferred direction: sequential yellow, green, and
 *    blue, because red and green would imply a judgment the data does not have.
 *  - Temperatures with no preferred direction: cool to warm, blue for the
 *    coldest value and red for the warmest, as weather maps show them. See
 *    `isTemperature` for what counts.
 *  - Ordinal labels: sequential purple. The order is certain, but which end
 *    is better usually is not.
 *
 * On dark backgrounds the sequential and ordinal scales ramp from the
 * background toward their hue, so the lowest value recedes instead of glowing.
 */
import { interpolateLab } from "d3-interpolate";
import { scaleSequential, scaleSequentialLog } from "d3-scale";
import { interpolatePurples, interpolateRdYlBu, interpolateYlGnBu } from "d3-scale-chromatic";
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
/** RdYlBu reversed, so 0 (coldest) is blue and 1 (warmest) is red. */
const TEMPERATURE = clampRange((t) => interpolateRdYlBu(1 - t), 0.06, 0.94);
/** On dark pages the ends carry the color and middling values fade, as the diverging dark ramps do. */
const TEMPERATURE_DARK = { cold: "#6f9bd6", warm: "#e0533f" } as const;

/** Units that always mean a temperature. */
const TEMPERATURE_UNITS = new Set(["°C", "°F"]);
/** Header words for a bare `°` that is an angle, a direction or a coordinate, not a temperature. */
const ANGLE_HEADER =
  /^(?:dir|direction|bearing|heading|course|angle|azimuth|lat|latitude|lon|lng|long|longitude|slope|incline|inclination|tilt|pitch|roll|yaw|rotation|elevation|altitude|declination|wind)$/;
/** A bare `°` beyond this is more likely an angle (0–360) than a temperature. */
const TEMPERATURE_RANGE: readonly [number, number] = [-90, 140];

/**
 * True when a neutral number column is a temperature, so it gets the cool to
 * warm scheme instead of yellow to blue. `°C` and `°F` always count. A bare
 * `°` counts only when the header names no angle, direction or coordinate
 * ("Wind", "Bearing", "Lat") and every value is within -90 to 140, since
 * bearings run to 360. A column with a better end keeps its diverging scale.
 */
export const isTemperature = (e: ColumnEncoding): boolean => {
  if (e.kind !== "quantitative" || e.polarity !== "neutral" || e.unit === null) return false;
  if (TEMPERATURE_UNITS.has(e.unit)) return true;
  if (e.unit !== "°") return false;
  const words = e.header.toLowerCase().split(/[^a-z]+/);
  if (words.some((w) => ANGLE_HEADER.test(w))) return false;
  return e.domain[0] >= TEMPERATURE_RANGE[0] && e.domain[1] <= TEMPERATURE_RANGE[1];
};

const temperatureColor = (t: number, dark: boolean): { color: string; weight: number } => {
  const clamped = Math.min(1, Math.max(0, t));
  if (!dark) return { color: TEMPERATURE(clamped), weight: 1 };
  return {
    color: clamped < 0.5 ? TEMPERATURE_DARK.cold : TEMPERATURE_DARK.warm,
    weight: Math.abs(2 * clamped - 1) ** 0.8,
  };
};

/** Maps a value to 0–1 with D3's linear or log scale. */
const normalizer = (e: Extract<ColumnEncoding, { kind: "quantitative" }>): ((v: number) => number) => {
  const [lo, hi] = e.domain;
  if (lo === hi) return () => 0.5;
  const scale =
    e.transform === "log" && lo > 0
      ? scaleSequentialLog((t) => t)
          .domain([lo, hi])
          .clamp(true)
      : scaleSequential((t) => t)
          .domain([lo, hi])
          .clamp(true);
  return (v) => scale(v);
};

/**
 * The position of every data row on the column's scale, from 0 to 1, after
 * polarity. 1 is always "better", or "more" when there is no better. Null where
 * the cell is missing or excluded.
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
  if (isTemperature(e)) return temperatureColor(t, dark);
  const single = e.kind === "ordinal" ? ORDINAL : e.polarity === "neutral" ? SEQUENTIAL : null;
  if (single === null) return divergingColor(palette, t, dark);
  return dark ? { color: single(1), weight: 0.2 + 0.8 * t } : { color: single(t), weight: 1 };
};

/** Gradient stops for legends, from the low value to the high value, before polarity. */
export const legendStops = (e: ColumnEncoding, palette: PaletteId, dark = false, mid = "#e9e6df", n = 9): string[] => {
  if (e.kind === "ordinal") return Array.from({ length: n }, (_, i) => ORDINAL(i / (n - 1)));
  if (isTemperature(e))
    return Array.from({ length: n }, (_, i) => {
      const { color, weight } = temperatureColor(i / (n - 1), dark);
      return weight === 1 ? color : interpolateLab(mid, color)(weight);
    });
  if (e.polarity === "neutral") return Array.from({ length: n }, (_, i) => SEQUENTIAL(i / (n - 1)));
  const stops = divergingStops(palette, dark, mid, n);
  return e.polarity === "lower_is_better" ? stops.reverse() : stops;
};
