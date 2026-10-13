/**
 * Google Sheets: a selected range in, the request to judge it out; the
 * judgment back in, the formatting that shades it out. Pure, so it runs in
 * Apps Script and in tests alike; addon.ts does the reading and writing.
 *
 * Numeric columns get Sheets' own color-scale rules (min, mid, max points),
 * so the shading follows the data as it is edited. Ordered labels get one
 * "text is exactly" rule per level. Columns whose numbers are stored as text
 * ("1,200 GB") can't drive a color scale and are filled cell by cell instead.
 */
import { rgb } from "d3-color";
import { legendStops, positions, schemeColor, type Palette } from "../core/scale.ts";
import { cellFill } from "../core/tint.ts";
import type { ColumnEncoding, TableJudgment } from "../core/types.ts";

/** What /v1/judge takes. */
export interface JudgeRequest {
  readonly title: string;
  readonly table: { readonly title: string | null; readonly headers: string[]; readonly rows: string[][] };
}

/** A rectangle of cells, 0-based offsets from the range's top-left cell. */
export interface Block {
  readonly row: number;
  readonly col: number;
  readonly rows: number;
  readonly cols: number;
}

export interface Point {
  readonly color: string;
  readonly value: number;
}

export type Formatting =
  | { readonly kind: "scale"; readonly header: string; readonly blocks: Block[]; readonly min: Point; readonly mid: Point; readonly max: Point }
  | { readonly kind: "levels"; readonly header: string; readonly blocks: Block[]; readonly levels: { readonly text: string; readonly color: string }[] }
  | { readonly kind: "fill"; readonly header: string; readonly cells: { readonly row: number; readonly col: number; readonly color: string }[] };

/** Sheets' own grid: shading sits on white with dark text. */
const SHEET_BACKGROUND = "#ffffff";
const SHEET_TEXT = "#000000";
/** Below this share of real numbers, a column is shaded as fills rather than a color scale. */
const NUMERIC_SHARE = 0.9;

const letters = (col: number): string => {
  let s = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/**
 * The range as a table: the first row is the header row. Blank rows and
 * columns at the edges are dropped; a blank header is named by its column
 * letter, as Sheets shows it.
 */
export const requestFromRange = (
  display: readonly (readonly string[])[],
  spreadsheet: string,
  sheet: string,
  firstCol = 0,
): { request: JudgeRequest; rows: number; cols: number } => {
  const blank = (s: string | undefined) => (s ?? "").trim() === "";
  let rows = display.length;
  while (rows > 0 && display[rows - 1]!.every(blank)) rows--;
  let cols = Math.max(0, ...display.slice(0, rows).map((r) => r.length));
  while (cols > 0 && display.slice(0, rows).every((r) => blank(r[cols - 1]))) cols--;
  const cell = (r: number, c: number) => (display[r]?.[c] ?? "").trim();
  const headers = Array.from({ length: cols }, (_, c) => cell(0, c) || letters(firstCol + c));
  const body = Array.from({ length: Math.max(0, rows - 1) }, (_, r) => Array.from({ length: cols }, (_, c) => cell(r + 1, c)));
  return { request: { title: spreadsheet, table: { title: sheet, headers, rows: body } }, rows, cols };
};

/**
 * Where value `i` of encoding `e` sits in the range. Row-oriented tables
 * were judged transposed: encoding column j is the range's data row j - 1,
 * and value i is range column i + 1.
 */
const cellOf = (judgment: TableJudgment, e: ColumnEncoding, i: number): { row: number; col: number } =>
  judgment.orientation === "rows" ? { row: e.col, col: i + 1 } : { row: i + 1, col: e.col };

/** Runs of adjacent cells along one row or column, as blocks. */
const blocksOf = (cells: readonly { row: number; col: number }[]): Block[] => {
  const blocks: Block[] = [];
  for (const c of cells) {
    const last = blocks.at(-1);
    if (last !== undefined && last.cols === 1 && last.col === c.col && last.row + last.rows === c.row) {
      blocks[blocks.length - 1] = { ...last, rows: last.rows + 1 };
    } else if (last !== undefined && last.rows === 1 && last.row === c.row && last.col + last.cols === c.col) {
      blocks[blocks.length - 1] = { ...last, cols: last.cols + 1 };
    } else {
      blocks.push({ row: c.row, col: c.col, rows: 1, cols: 1 });
    }
  }
  return blocks;
};

/** A scheme color as it reads on the sheet (tinted over white, text kept legible), as hex: Apps Script takes no rgb(). */
const onSheet = (color: string, weight = 1) => rgb(cellFill(color, weight, SHEET_BACKGROUND, SHEET_TEXT).fill).formatHex();

/**
 * The formatting for one judged table. `raw` is the range's underlying
 * values (numbers stay numbers), the same shape as the display text the
 * request was built from.
 */
export const planFormatting = (judgment: TableJudgment, raw: readonly (readonly unknown[])[], palette: Palette): Formatting[] => {
  const excluded = new Set(judgment.aggregateRows);
  return judgment.encodings.map((e): Formatting => {
    const indexes = e.values.map((_, i) => i).filter((i) => !excluded.has(i) && e.values[i] !== null);
    const cells = indexes.map((i) => cellOf(judgment, e, i));

    if (e.kind === "ordinal") {
      // One "text is exactly" rule per level; Sheets matches text case-insensitively, as the judge normalized it.
      const last = Math.max(1, e.order.length - 1);
      return {
        kind: "levels",
        header: e.header,
        blocks: blocksOf(cells),
        levels: e.labels.map((text, k) => ({ text, color: onSheet(schemeColor(e, palette, k / last, false).color) })),
      };
    }

    const numeric = cells.filter((c) => typeof raw[c.row]?.[c.col] === "number").length;
    if (cells.length === 0 || numeric / cells.length < NUMERIC_SHARE) {
      const pos = positions(e, excluded);
      return {
        kind: "fill",
        header: e.header,
        cells: indexes.map((i) => {
          const { color, weight } = schemeColor(e, palette, pos[i]!, false);
          return { ...cellOf(judgment, e, i), color: onSheet(color, weight) };
        }),
      };
    }

    // Stops run low value → high value, already flipped when lower is better.
    const [lo, hi] = e.domain;
    const [low, middle, high] = legendStops(e, palette, false, SHEET_BACKGROUND, 3).map((c) => onSheet(c));
    const mid = e.transform === "log" && lo > 0 ? Math.sqrt(lo * hi) : (lo + hi) / 2;
    return {
      kind: "scale",
      header: e.header,
      blocks: blocksOf(cells),
      min: { color: low!, value: lo },
      mid: { color: middle!, value: mid },
      max: { color: high!, value: hi },
    };
  });
};
