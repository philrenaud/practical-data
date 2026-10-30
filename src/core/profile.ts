/**
 * Profiles the columns of a table. The code decides what a column can be
 * (numbers, a short set of labels, or free text) and computes every
 * statistic. The decision model judges only meaning. docs/decisions.md
 * explains the split.
 */
import { parseDate } from "./dates.ts";
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
  /** True when the values are exactly 1 to n in row order, which almost always means a rank column. */
  readonly isSequence: boolean;
  /** True when every value is an integer from 1800 to 2100. */
  readonly looksLikeYears: boolean;
  /** Share of parsed values written as bounds ("≤ 272K", "65+"). */
  readonly boundShare: number;
  /** Share of parsed values written as ranges ("20–25"). A range is compared by its midpoint. */
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
  /** The normalized label of each row. Null when the cell is missing. */
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
  /** The first five cells. Questions about other columns use them as row labels. */
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

/** `display` is the cell text for samples when `cells` were rewritten, as for streaks. */
const profileNumeric = (
  col: number,
  header: string,
  cells: readonly string[],
  display: readonly string[] = cells,
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
  const samples = [...new Set([0, 0.25, 0.5, 0.75, 1].map(at))].map((i) => stripNoise(display[i] ?? ""));

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

const profileCategorical = (col: number, header: string, cells: readonly string[]): CategoricalProfile | string => {
  const values = cells.map((c) => (isMissing(c) ? null : normalizeLabel(c)));
  const filled = values.filter((v) => v !== null);
  // A Map treats labels such as "constructor" and "__proto__" as ordinary keys. An object does not.
  const first = new Map<string, string>();
  cells.forEach((c, i) => {
    const v = values[i];
    if (v != null && !first.has(v)) first.set(v, stripNoise(c));
  });
  const levels = [...first.keys()];
  const display: Record<string, string> = Object.fromEntries(first);
  if (filled.length < MIN_FILLED) return "too few filled cells";
  if (levels.length < 2) return "single value";
  if (levels.length > MAX_ORDINAL_LEVELS) return "too many distinct values";
  if (levels.some((l) => l.length > 32)) return "values are long text";
  // All-unique labels are names, unless the list is short enough to be a full
  // ranking (Tropical storm, Category 1 … Category 5). The model decides those.
  if (levels.length === filled.length && filled.length > 8) return "every value is unique";
  return { kind: "categorical", col, header, values, levels, display };
};

/** A win, loss, or tie streak: "W3", "L2", "3W", "5L", "T1". */
const STREAK_RE = /^(?:([WLT])\s?(\d{1,2})|(\d{1,2})\s?([WLT]))$/;
const STREAK_HEADER = /\b(?:strk|streak)\b/i;

/**
 * Reads a streak column as wins minus losses: W3 is 3, L2 is -2, and a tie
 * streak is 0. A letter after a number is also a unit ("5L" is five liters),
 * so a column is a streak column only when every filled cell has the form
 * and the column has both W and L or its header names a streak. Returns the
 * cells rewritten as signed numbers, or null.
 */
const readStreaks = (header: string, cells: readonly string[]): readonly string[] | null => {
  const letters = new Set<string>();
  let filled = 0;
  const out: string[] = [];
  for (const cell of cells) {
    if (isMissing(cell)) {
      out.push(cell);
      continue;
    }
    const m = STREAK_RE.exec(stripNoise(cell));
    if (m === null) return null;
    const letter = m[1] ?? m[4] ?? "";
    const n = Number(m[2] ?? m[3]);
    letters.add(letter);
    filled++;
    out.push(String(letter === "W" ? n : letter === "L" ? -n : 0));
  }
  if (filled < MIN_FILLED) return null;
  return (letters.has("W") && letters.has("L")) || STREAK_HEADER.test(header) ? out : null;
};

/** A date, a clock time, or a relative time ("3 days ago", which would otherwise parse as 3 days). */
const looksLikeDate = (cell: string): boolean => isDateLike(cell) || parseDate(cell, { now: 0 }) !== null;

/** Profiles every column of a table. */
export const profileTable = (table: TableSnapshot): readonly ColumnProfile[] =>
  table.headers.map((rawHeader, col) => {
    const header = stripNoise(rawHeader);
    const cells = table.rows.map((r) => r[col] ?? "");
    const filled = cells.filter((c) => !isMissing(c));
    // Dates stay out of the model's requests. judge.ts shades the ones that dates.ts parses.
    if (filled.length > 0 && filled.filter(looksLikeDate).length / filled.length >= NUMERIC_SHARE) {
      return { kind: "text", col, header, reason: "dates or times", samples: cells.slice(0, 5).map(stripNoise) };
    }
    const streaks = readStreaks(header, cells);
    const parsed = streaks === null ? profileNumeric(col, header, cells) : profileNumeric(col, header, streaks, cells);
    const numeric = parsed !== null && streaks !== null ? { ...parsed, unit: "streak" } : parsed;
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

/** Describes the spread of a numeric column in words, because Jev reads words better than ratios. */
export const describeSpread = (p: NumericProfile): string => {
  if (p.decades === null) return "includes zero or negative values";
  if (p.decades < 0.3) return "values are within a factor of 2 of each other";
  if (p.decades < 1) return "largest value is under 10 times the smallest";
  const n = Math.round(p.decades);
  return `values span about ${n} order${n === 1 ? "" : "s"} of magnitude (largest is ~${Math.round(
    p.max / p.min,
  ).toLocaleString("en-US")} times the smallest)`;
};
