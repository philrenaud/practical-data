/**
 * Row-oriented tables (benchmarks as rows, models as columns) are judged by
 * transposing them: each original row becomes a column, and the original
 * header row becomes the row-label column. Everything downstream works on
 * columns, unchanged.
 */
import type { TableSnapshot } from "./types.ts";

export type Orientation = "columns" | "rows";

/**
 * Transposes a snapshot. Assumes the first column holds row labels:
 * original row j → column j + 1, original column c (c ≥ 1) → row c - 1.
 */
export const transposeSnapshot = (t: TableSnapshot): TableSnapshot => ({
  id: t.id,
  title: t.title,
  headers: [t.headers[0] ?? "", ...t.rows.map((r) => r[0] ?? "")],
  rows: t.headers.slice(1).map((h, i) => [h, ...t.rows.map((r) => r[i + 1] ?? "")]),
});
