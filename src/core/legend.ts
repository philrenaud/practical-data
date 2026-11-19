/**
 * Builds the text of the hover card for a shaded column: a status line, the
 * values at the ends of the scale, and a few facts. The painter supplies the
 * encoding and the page context.
 */
import { formatDate, isDateUnit } from "./dates.ts";
import { rangeTrack, type RangeTrack } from "./range.ts";
import { isTemperature, legendStops, type Palette } from "./scale.ts";
import type { ColumnEncoding } from "./types.ts";

export interface Legend {
  readonly title: string;
  /** "Lower is better · Log scale", "Ranked categories · 3 levels". */
  readonly status: string;
  /** Gradient stops, from the low value to the high value. */
  readonly stops: readonly string[];
  readonly lo: string;
  readonly hi: string;
  /** Short qualifiers: "Found in 3 tables", "Excludes total: World". */
  readonly facts: readonly string[];
  /** The ends of the scale as numbers, for editing. Null when the column has no numeric range to edit. */
  readonly range: LegendRange | null;
}

export interface LegendRange {
  readonly lo: number;
  readonly hi: number;
  /** The column's unit ("$", "%", "GB"), or null. */
  readonly unit: string | null;
  /** The range fitted to the data. It equals `lo` and `hi` unless the user set a range. */
  readonly fit: readonly [number, number];
  /** The span the range slider covers. */
  readonly track: RangeTrack;
  /** True when the user set the range. */
  readonly custom: boolean;
  /** Ranges to offer in one step. A null range puts the fitted range back. */
  readonly presets: readonly { readonly label: string; readonly range: readonly [number, number] | null }[];
}

export interface LegendContext {
  /** Tables on the page using this column's scale, including this one. */
  readonly sharedWith: number;
  /** First-cell labels of rows left out as totals ("World", "Total"). */
  readonly aggregates: readonly string[];
}

const CURRENCY = /^[$€£¥₹₩₽₺]$|\$$/;

const formatNumber = (v: number): string =>
  Math.abs(v) >= 1e4 || (Math.abs(v) < 0.01 && v !== 0)
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 }).format(v)
    : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(v);

const pad = (n: number) => String(Math.round(n)).padStart(2, "0");

/** Formats a base-60 duration as a clock time. 179 is "2:59" and 3723 is "1:02:03". */
const clock = (v: number): string =>
  v >= 3600
    ? `${Math.floor(v / 3600)}:${pad(Math.floor((v % 3600) / 60))}:${pad(v % 60)}`
    : `${Math.floor(v / 60)}:${pad(v % 60)}`;

/** Formats a value with its column's unit, for a legend. */
export const withUnit = (v: number, unit: string | null, now: number = Date.now()): string => {
  if (unit === ":") return clock(v);
  if (unit === "streak") return v > 0 ? `W${v}` : v < 0 ? `L${-v}` : "0";
  if (isDateUnit(unit)) return formatDate(v, unit, now);
  const n = formatNumber(v);
  if (unit === null) return n;
  if (CURRENCY.test(unit)) return v < 0 ? `-${unit}${n.slice(1)}` : `${unit}${n}`;
  return unit === "%" || unit === "x" ? `${n}${unit}` : `${n} ${unit}`;
};

const DIRECTION: Readonly<Record<ColumnEncoding["polarity"], string>> = {
  higher_is_better: "Higher is better",
  lower_is_better: "Lower is better",
  neutral: "No better direction",
};

/** The ratio of the ends of a log scale, such as "200× range" or "1.4M× range". */
const spread = (lo: number, hi: number): string =>
  `${new Intl.NumberFormat("en-US", { notation: hi / lo >= 1e4 ? "compact" : "standard", maximumSignificantDigits: 2 }).format(hi / lo)}× range`;

/** A header that says its numbers are percentages. */
const PERCENT_HEADER = /%|\bpercent|\bpct\b/i;

/** Units whose values are not plain numbers on the page: clock times and win or loss streaks. */
const CODED_UNITS = new Set([":", "streak"]);

/**
 * The editable range of a number column, with the presets that would change
 * it. Presets come from the range fitted to the data, so they stay the same
 * while the user tries others. Dates, clock times and streaks have none,
 * because a number input can't write them the way the page does.
 */
const editableRange = (e: Extract<ColumnEncoding, { kind: "quantitative" }>): LegendRange | null => {
  if (isDateUnit(e.unit) || (e.unit !== null && CODED_UNITS.has(e.unit))) return null;
  const [lo, hi] = e.domain;
  const [fitLo, fitHi] = e.fit ?? e.domain;
  // Some pages write percentages without the sign and name it in the header.
  const percent = e.unit === "%" || (e.unit === null && PERCENT_HEADER.test(e.header));
  const presets: { label: string; range: readonly [number, number] | null }[] = [];
  if (e.fit !== undefined) presets.push({ label: "Fit to data", range: null });
  // A log scale has no zero.
  if (e.transform !== "log") {
    if (fitLo > 0) presets.push({ label: "From zero", range: [0, fitHi] });
    if (fitHi < 0) presets.push({ label: "To zero", range: [fitLo, 0] });
    if (percent && fitLo >= 0 && fitHi <= 100) presets.push({ label: "0 to 100", range: [0, 100] });
  }
  return {
    lo,
    hi,
    unit: e.unit,
    fit: [fitLo, fitHi],
    track: rangeTrack([fitLo, fitHi], [lo, hi], { log: e.transform === "log", percent }),
    custom: e.fit !== undefined,
    presets: presets.filter((p) => p.range === null || p.range[0] !== lo || p.range[1] !== hi),
  };
};

/** The legend for one shaded column. */
export const describeColumn = (e: ColumnEncoding, palette: Palette, dark: boolean, ctx: LegendContext): Legend => {
  const facts: string[] = [];
  let status: string;
  if (e.kind === "quantitative") {
    const [lo, hi] = e.domain;
    const log = e.transform === "log" && lo > 0;
    status = isDateUnit(e.unit)
      ? `${e.unit === "weektime" ? "Times" : "Dates"} · Earliest to latest`
      : `${isTemperature(e) ? "Cold to warm" : DIRECTION[e.polarity]} · ${log ? "Log scale" : "Linear scale"}`;
    if (log) facts.push(spread(lo, hi));
    if (e.fit !== undefined)
      facts.push(`Custom range · Data ${withUnit(e.fit[0], e.unit)} to ${withUnit(e.fit[1], e.unit)}`);
  } else {
    status = `Ranked categories · ${e.order.length} levels`;
  }
  if (ctx.sharedWith > 1) facts.push(`Found in ${ctx.sharedWith} tables`);
  if (ctx.aggregates.length > 0) facts.push(`Excludes total: ${ctx.aggregates.join(", ")}`);
  return {
    title: e.header || "Untitled column",
    status,
    stops: legendStops(e, palette, dark, dark ? "#3a3840" : "#e9e6df"),
    lo: e.kind === "quantitative" ? withUnit(e.domain[0], e.unit) : (e.labels[0] ?? ""),
    hi: e.kind === "quantitative" ? withUnit(e.domain[1], e.unit) : (e.labels.at(-1) ?? ""),
    facts,
    range: e.kind === "quantitative" ? editableRange(e) : null,
  };
};
