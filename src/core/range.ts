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
