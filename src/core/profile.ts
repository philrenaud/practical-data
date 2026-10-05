/**
 * Column profiling. Code decides what is *possible* (numeric vs. a short set of
 * labels vs. free text) and computes every statistic; the decision model only
 * judges meaning. See docs/decisions.md for the split.
 */
import { isDateLike, isMissing, normalizeLabel, parseNumber, stripNoise } from "./parse.ts";
import type { TableSnapshot } from "./types.ts";

export const MAX_ORDINAL_LEVELS = 12;
const MIN_FILLED = 3;
const NUMERIC_SHARE = 0.8;

export type ColumnProfile = NumericProfile | CategoricalProfile | TextProfile;

export interface NumericProfile {
  readonly kind: "numeric";
  readonly col: number;
  readonly header: string;
  readonly values: readonly (number | null)[];
  /** Most common unit among parsed cells. */
  readonly unit: string | null;
  readonly min: number;
  readonly max: number;
  readonly distinct: number;
  /** log10(max / min) when every value is positive, else null. */
  readonly decades: number | null;
  /** Values are exactly 1..n in row order: almost always a rank column. */
  readonly isSequence: boolean;
  /** Every value is an integer between 1800 and 2100. */
  readonly looksLikeYears: boolean;
  /** Share of parsed values written as bounds ("≤ 272K", "65+"). */
  readonly boundShare: number;
  /** Share of parsed values written as ranges ("20–25"); compared by midpoint. */
  readonly rangeShare: number;
  /** Share of parsed values written as clock durations ("2:59"). */
  readonly durationShare: number;
  /** Original cell text at min, quartiles, and max. */
  readonly samples: readonly string[];
}

export interface CategoricalProfile {
  readonly kind: "categorical";
  readonly col: number;
  readonly header: string;
  /** Normalized label per row; null when missing. */
  readonly values: readonly (string | null)[];
  /** Distinct normalized labels in first-seen order. */
  readonly levels: readonly string[];
  /** Display text for each level (first occurrence). */
  readonly display: Readonly<Record<string, string>>;
}

export interface TextProfile {
  readonly kind: "text";
  readonly col: number;
  readonly header: string;
  readonly reason: string;
  /** First few cells; used as row-label context for other questions. */
  readonly samples: readonly string[];
}

const mode = <A>(xs: readonly A[]): A | undefined => {
  const counts = new Map<A, number>();
  let best: A | undefined;
  let bestCount = 0;
  for (const x of xs) {
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (c > bestCount) {
      best = x;
      bestCount = c;
    }
  }
  return best;
};

const profileNumeric = (
  col: number,
  header: string,
  cells: readonly string[],
): NumericProfile | null => {
  const filled = cells.filter((c) => !isMissing(c));
  const parsed = cells.map((c) => (isMissing(c) ? null : parseNumber(c)));
  const numeric = parsed.filter((p) => p !== null);
  if (filled.length < MIN_FILLED || numeric.length / filled.length < NUMERIC_SHARE) return null;

  const values = parsed.map((p) => p?.value ?? null);
  const nums = numeric.map((p) => p.value);
  // A loop, not Math.min(...nums): spreading ~120k+ arguments throws RangeError.
  let min = Infinity;
  let max = -Infinity;
  for (const v of nums) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const sortedIdx = parsed
    .map((p, i) => [p?.value, i] as const)
    .filter((e): e is readonly [number, number] => e[0] !== undefined)
    .sort((a, b) => a[0] - b[0]);
  const at = (q: number) => sortedIdx[Math.round(q * (sortedIdx.length - 1))]?.[1] ?? 0;
  const samples = [...new Set([0, 0.25, 0.5, 0.75, 1].map(at))].map((i) => stripNoise(cells[i] ?? ""));

  return {
    kind: "numeric",
    col,
    header,
    values,
    unit: mode(numeric.map((p) => p.unit)) ?? null,
    min,
    max,
    distinct: new Set(nums).size,
    decades: min > 0 ? Math.log10(max / min) : null,
    isSequence: nums.length === cells.length && nums.every((v, i) => v === i + 1),
    looksLikeYears: nums.every((v) => Number.isInteger(v) && v >= 1800 && v <= 2100),
    boundShare: numeric.filter((p) => p.bound).length / numeric.length,
    rangeShare: numeric.filter((p) => p.range !== null).length / numeric.length,
    durationShare: numeric.filter((p) => p.unit === ":").length / numeric.length,
    samples,
  };
};

const profileCategorical = (
  col: number,
  header: string,
  cells: readonly string[],
): CategoricalProfile | string => {
  const values = cells.map((c) => (isMissing(c) ? null : normalizeLabel(c)));
  const filled = values.filter((v) => v !== null);
  const display: Record<string, string> = {};
  const levels: string[] = [];
  cells.forEach((c, i) => {
    const v = values[i];
    if (v != null && !(v in display)) {
      display[v] = stripNoise(c);
      levels.push(v);
    }
  });
  if (filled.length < MIN_FILLED) return "too few filled cells";
  if (levels.length < 2) return "single value";
  if (levels.length > MAX_ORDINAL_LEVELS) return "too many distinct values";
  if (levels.some((l) => l.length > 32)) return "values are long text";
  // All-unique labels are names, unless the list is short enough to be a full
  // ranking (Tropical storm, Category 1 … Category 5); the model sorts those out.
  if (levels.length === filled.length && filled.length > 8) return "every value is unique";
  return { kind: "categorical", col, header, values, levels, display };
};

/** Profiles every column of a table. */
export const profileTable = (table: TableSnapshot): readonly ColumnProfile[] =>
  table.headers.map((rawHeader, col) => {
    const header = stripNoise(rawHeader);
    const cells = table.rows.map((r) => r[col] ?? "");
    const filled = cells.filter((c) => !isMissing(c));
    if (filled.length > 0 && filled.filter(isDateLike).length / filled.length >= NUMERIC_SHARE) {
      return { kind: "text", col, header, reason: "dates or times", samples: cells.slice(0, 5).map(stripNoise) };
    }
    const numeric = profileNumeric(col, header, cells);
    if (numeric !== null) {
      if (numeric.distinct < 2) {
        return { kind: "text", col, header, reason: "constant", samples: cells.slice(0, 5) };
      }
      return numeric;
    }
    const cat = profileCategorical(col, header, cells);
    if (typeof cat !== "string") return cat;
    return {
      kind: "text",
      col,
      header,
      reason: cat,
      samples: cells.slice(0, 5).map(stripNoise),
    };
  });

/** Plain-language description of a numeric spread; Jev reads words better than ratios. */
export const describeSpread = (p: NumericProfile): string => {
  if (p.decades === null) return "includes zero or negative values";
  if (p.decades < 0.3) return "values are within a factor of 2 of each other";
  if (p.decades < 1) return "largest value is under 10 times the smallest";
  const n = Math.round(p.decades);
  return `values span about ${n} order${n === 1 ? "" : "s"} of magnitude (largest is ~${Math.round(
    p.max / p.min,
  ).toLocaleString("en-US")} times the smallest)`;
};
