/**
 * The user's own ranges for number columns. A column's scale normally runs
 * from its lowest value to its highest, so the two ends always get the
 * strongest colors, however close they are. A saved range replaces that
 * extent: values inside it spread over part of the scale, and values outside
 * it take the end color.
 *
 * A range on a shared scale belongs to the page and applies to every table
 * that shares it. A range on any other column belongs to its table. A table
 * taken off the shared scales (isolate.ts) has no shared columns, so it
 * ignores the shared ranges and keeps its own.
 */
import type { ColumnEncoding, TableJudgment, TableSnapshot } from "./types.ts";

export type ScaleRange = readonly [number, number];

/** The saved ranges of one page. */
export interface PageRanges {
  /** Ranges of shared scales, by column header. */
  readonly shared: Readonly<Record<string, ScaleRange>>;
  /** Ranges of each table's own columns, by `rangeTableKey` and then by column key. */
  readonly tables: Readonly<Record<string, Readonly<Record<string, ScaleRange>>>>;
}

export const EMPTY_RANGES: PageRanges = { shared: {}, tables: {} };

/** True if a scale can run from `range[0]` to `range[1]`. */
export const isUsableRange = (range: ScaleRange): boolean =>
  Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] < range[1];

/**
 * Keys a table by its title and headers. The rows are left out, so the key
 * holds when the page sorts the table or its numbers change from one visit to
 * the next. Two tables on a page with the same title and headers share a key.
 */
export const rangeTableKey = (t: TableSnapshot): string => {
  const text = `${t.title ?? ""}␞${t.headers.join("␟")}`;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** The key of each encoding within its table: the header, numbered when an earlier encoding has the same one. */
const columnKeys = (encodings: readonly ColumnEncoding[]): string[] => {
  const seen = new Map<string, number>();
  return encodings.map((e) => {
    const n = seen.get(e.header) ?? 0;
    seen.set(e.header, n + 1);
    return n === 0 ? e.header : `${e.header}␟${n}`;
  });
};

/**
 * Replaces the domain of each number column that has a saved range, and
 * records the fitted extent in `fit`. A log scale whose range reaches zero
 * or below becomes linear. Pass the judgment as it is shown: isolate it first
 * if the table is off the shared scales.
 */
export const applyRanges = (t: TableJudgment, tableKey: string, ranges: PageRanges): TableJudgment => {
  const own = ranges.tables[tableKey] ?? {};
  const keys = columnKeys(t.encodings);
  let changed = false;
  const encodings = t.encodings.map((e, i): ColumnEncoding => {
    if (e.kind !== "quantitative") return e;
    const range = e.group !== null ? ranges.shared[e.header] : own[keys[i]!];
    if (range === undefined || !isUsableRange(range)) return e;
    changed = true;
    const transform = e.transform === "log" && range[0] <= 0 ? "linear" : e.transform;
    return { ...e, domain: [range[0], range[1]], fit: e.domain, transform };
  });
  return changed ? { ...t, encodings } : t;
};

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _, ...rest } = record;
  return rest;
};

/**
 * Returns `ranges` with the range of the column at `col` set, or removed when
 * `range` is null. `t` is the judgment as it is shown, so a column on a shared
 * scale sets the page's shared range and any other column sets its table's own.
 */
export const setRange = (
  ranges: PageRanges,
  t: TableJudgment,
  tableKey: string,
  col: number,
  range: ScaleRange | null,
): PageRanges => {
  const i = t.encodings.findIndex((e) => e.col === col && e.kind === "quantitative");
  const e = t.encodings[i];
  if (e === undefined) return ranges;
  if (e.group !== null) {
    return {
      ...ranges,
      shared: range === null ? without(ranges.shared, e.header) : { ...ranges.shared, [e.header]: range },
    };
  }
  const key = columnKeys(t.encodings)[i]!;
  const own = ranges.tables[tableKey] ?? {};
  const next = range === null ? without(own, key) : { ...own, [key]: range };
  return {
    ...ranges,
    tables: Object.keys(next).length === 0 ? without(ranges.tables, tableKey) : { ...ranges.tables, [tableKey]: next },
  };
};

/** Limits on the ranges of one page that are read from a message or from storage. */
export const RANGE_LIMITS = { tables: 50, columns: 100, keyLength: 200 } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const readColumns = (v: unknown): Record<string, ScaleRange> => {
  if (!isRecord(v)) return {};
  const out: Record<string, ScaleRange> = {};
  for (const [key, range] of Object.entries(v)) {
    if (Object.keys(out).length >= RANGE_LIMITS.columns) break;
    if (key.length > RANGE_LIMITS.keyLength || !Array.isArray(range) || range.length !== 2) continue;
    const [lo, hi] = range as unknown[];
    if (typeof lo !== "number" || typeof hi !== "number" || !isUsableRange([lo, hi])) continue;
    out[key] = [lo, hi];
  }
  return out;
};

/**
 * Reads page ranges from a value of unknown shape, such as a message from a
 * content script. Entries that are not usable ranges are dropped, and so are
 * entries past `RANGE_LIMITS`.
 */
export const readRanges = (v: unknown): PageRanges => {
  if (!isRecord(v)) return EMPTY_RANGES;
  const tables: Record<string, Record<string, ScaleRange>> = {};
  if (isRecord(v["tables"])) {
    for (const [key, columns] of Object.entries(v["tables"])) {
      if (Object.keys(tables).length >= RANGE_LIMITS.tables) break;
      if (key.length > RANGE_LIMITS.keyLength) continue;
      const read = readColumns(columns);
      if (Object.keys(read).length > 0) tables[key] = read;
    }
  }
  return { shared: readColumns(v["shared"]), tables };
};

// ── Slider track ────────────────────────────────────────────────────────────

/** The span of values a range slider covers. Its two thumbs are the ends of the scale. */
export interface RangeTrack {
  readonly min: number;
  readonly max: number;
  /** True when positions are spaced by ratio, for a log scale. */
  readonly log: boolean;
}

/** A log track reaches at least this many times past each end of the data. */
const MIN_LOG_REACH = 3;

/**
 * The track for a column's slider. It leaves room past both ends of the
 * fitted range `fit`, so the user can widen the scale by sliding:
 *
 * - Data at or above zero: from zero to as far past the top as the top is
 *   from zero, or one more span if that is longer. A percent column within
 *   0 to 100 gets exactly 0 to 100.
 * - Data at or below zero: the mirror of that.
 * - Data on both sides of zero: one more span each way.
 * - A log scale: the same ratio past each end, so the data is the middle half.
 *
 * The track stretches to hold `current` when a saved range lies beyond it.
 */
export const rangeTrack = (
  fit: ScaleRange,
  current: ScaleRange,
  opts: { readonly log: boolean; readonly percent: boolean },
): RangeTrack => {
  const [lo, hi] = fit;
  const widen = (min: number, max: number, log: boolean): RangeTrack => ({
    min: Math.min(min, current[0]),
    max: Math.max(max, current[1]),
    log,
  });
  if (opts.log && lo > 0 && current[0] > 0) {
    const reach = Math.max(Math.sqrt(hi / lo), MIN_LOG_REACH);
    return widen(lo / reach, hi * reach, true);
  }
  // A single value has no span; its distance from zero stands in.
  const span = hi - lo || Math.abs(hi) || 1;
  if (lo >= 0) return widen(0, opts.percent && hi <= 100 ? 100 : hi + Math.max(span, hi), false);
  if (hi <= 0) return widen(lo - Math.max(span, -lo), 0, false);
  return widen(lo - span, hi + span, false);
};

/** Where `v` sits on the track, from 0 to 1. Values beyond the track sit at its ends. */
export const trackPosition = (t: RangeTrack, v: number): number => {
  const p = t.log ? Math.log(v / t.min) / Math.log(t.max / t.min) : (v - t.min) / (t.max - t.min);
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
};

/** The smallest of 1, 2 or 5 times a power of ten that is at least `target`. */
const roundStep = (target: number): number => {
  const power = 10 ** Math.floor(Math.log10(target));
  const m = target / power;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * power;
};

/** A slider position within this distance of a marked value lands on it. */
const SNAP = 0.015;
/** A linear track has about this many steps. */
const STEPS = 200;

/**
 * The value at position `p` (0 to 1) on the track, rounded so it reads
 * well: a step of 1, 2 or 5 times a power of ten on a linear track, two
 * significant digits on a log track. A position close to one of `marks`,
 * such as an end of the data, returns that mark exactly. The ends of the
 * track return its own ends.
 */
export const trackValue = (t: RangeTrack, p: number, marks: readonly number[] = []): number => {
  if (p <= 0) return t.min;
  if (p >= 1) return t.max;
  const near = marks.find((m) => m > t.min && m < t.max && Math.abs(trackPosition(t, m) - p) <= SNAP);
  if (near !== undefined) return near;
  if (t.log) return Number((t.min * (t.max / t.min) ** p).toPrecision(2));
  const step = roundStep((t.max - t.min) / STEPS);
  const raw = t.min + (t.max - t.min) * p;
  return Number((Math.round(raw / step) * step).toPrecision(12));
};
