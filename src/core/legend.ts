/**
 * What the hover card says about a colored column: a terse status line, the
 * scale's extents, and a few facts. Pure: the painter supplies the encoding
 * and page context.
 */
import { legendStops, type Palette } from "./scale.ts";
import type { ColumnEncoding } from "./types.ts";

export interface Legend {
  readonly title: string;
  /** "Lower is better · Log scale", "Ranked categories · 3 levels". */
  readonly status: string;
  /** Gradient stops, low value → high value. */
  readonly stops: readonly string[];
  readonly lo: string;
  readonly hi: string;
  /** Short qualifiers: "Found in 3 tables", "Excludes total: World". */
  readonly facts: readonly string[];
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

/** Base-60 durations back to clock form: 179 → "2:59", 3723 → "1:02:03". */
const clock = (v: number): string =>
  v >= 3600
    ? `${Math.floor(v / 3600)}:${pad(Math.floor((v % 3600) / 60))}:${pad(v % 60)}`
    : `${Math.floor(v / 60)}:${pad(v % 60)}`;

export const withUnit = (v: number, unit: string | null): string => {
  if (unit === ":") return clock(v);
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

/** "200× range", "3,000× range", "1.4M× range". */
const spread = (lo: number, hi: number): string =>
  `${new Intl.NumberFormat("en-US", { notation: hi / lo >= 1e4 ? "compact" : "standard", maximumSignificantDigits: 2 }).format(hi / lo)}× range`;

export const describeColumn = (e: ColumnEncoding, palette: Palette, dark: boolean, ctx: LegendContext): Legend => {
  const facts: string[] = [];
  let status: string;
  if (e.kind === "quantitative") {
    const [lo, hi] = e.domain;
    const log = e.transform === "log" && lo > 0;
    status = `${DIRECTION[e.polarity]} · ${log ? "Log scale" : "Linear scale"}`;
    if (log) facts.push(spread(lo, hi));
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
  };
};
