/**
 * Row-oriented tables (benchmarks as rows, models as columns) are judged
 * transposed. Each original row becomes a column, and the original header row
 * becomes the row-label column. The code after that works only on columns.
 */
import type { TableSnapshot } from "./types.ts";

export type Orientation = "columns" | "rows";

/**
 * Transposes a snapshot whose first column holds row labels. Original row j
 * becomes column j + 1, and original column c (c ≥ 1) becomes row c - 1.
 */
export const transposeSnapshot = (t: TableSnapshot): TableSnapshot => ({
  id: t.id,
  title: t.title,
  headers: [t.headers[0] ?? "", ...t.rows.map((r) => r[0] ?? "")],
  rows: t.headers.slice(1).map((h, i) => [h, ...t.rows.map((r) => r[i + 1] ?? "")]),
});
