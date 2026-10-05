/**
 * DOM → TableSnapshot. Resolves rowspan/colspan into a rectangular grid so a
 * column index means the same thing on every row, and keeps a parallel grid of
 * cell elements for painting.
 */
import { transposeSnapshot, type Orientation } from "../core/orient.ts";
import { parseNumber } from "../core/parse.ts";
import type { PageSnapshot, TableSnapshot } from "../core/types.ts";

export interface ExtractedTable {
  readonly element: HTMLTableElement;
  /** "rows" for a transposed view: each column below is one original row. */
  readonly axis: Orientation;
  readonly snapshot: TableSnapshot;
  /** `cells[row][col]`, aligned with `snapshot.rows`. Spanned cells repeat. */
  readonly cells: readonly (readonly HTMLTableCellElement[])[];
  /** Bottom-most header cell per column; where legends go. */
  readonly headerCells: readonly (HTMLTableCellElement | null)[];
}

const MAX_SPAN = 64;

/** Controls inside cells ("show", sort buttons) are not part of the data. */
const CONTROLS = "button, [role=button], .mw-collapsible-toggle, select, input";

const textOf = (el: HTMLElement): string =>
  // innerText honors display:none, which hides Wikipedia's sort keys.
  (el.isConnected && typeof el.innerText === "string" ? el.innerText : el.textContent) ?? "";

/**
 * Superscripts that annotate rather than carry data: footnote links
 * (Wikipedia, Statistics Canada) and one- or two-letter quality flags
 * ("74.3ʳ"). Exponents like km² have no link and are digits, so they stay.
 */
const isAnnotation = (sup: HTMLElement): boolean =>
  sup.querySelector("a") !== null || /^\s*(?:[A-Za-z]{1,2}|\[[^\]]*\])\s*$/.test(sup.textContent ?? "");

const BREAKS = new Set(["block", "list-item", "table-cell", "table-row", "flex", "grid"]);

/**
 * Visible text with annotations skipped in place. Removing an annotation's
 * text by string match would also delete that letter elsewhere in the cell
 * ("American" → "Americn" when the footnote is "a").
 */
const textSkipping = (cell: HTMLElement, skip: ReadonlySet<Element>): string => {
  let out = "";
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? "";
      } else if (child instanceof HTMLElement && !skip.has(child)) {
        if (child.tagName === "BR") {
          out += " ";
          continue;
        }
        if (child.isConnected && !child.checkVisibility()) continue;
        const block = child.isConnected && BREAKS.has(getComputedStyle(child).display);
        if (block) out += " ";
        walk(child);
        if (block) out += " ";
      }
    }
  };
  walk(cell);
  return out;
};

const cellText = (cell: HTMLElement): string => {
  const noise = cell.firstElementChild === null
    ? []
    : [...cell.querySelectorAll<HTMLElement>(CONTROLS), ...[...cell.querySelectorAll<HTMLElement>("sup")].filter(isAnnotation)];
  const text = noise.length === 0 ? textOf(cell) : textSkipping(cell, new Set(noise));
  return text.replace(/\s+/g, " ").trim();
};

/** Expands spans so grid[r][c] is the cell covering that slot. */
const buildGrid = (rows: readonly HTMLTableRowElement[]): HTMLTableCellElement[][] => {
  const grid: HTMLTableCellElement[][] = rows.map(() => []);
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of Array.from(row.cells)) {
      while (grid[r]![c] !== undefined) c++;
      const colspan = Math.min(Math.max(cell.colSpan || 1, 1), MAX_SPAN);
      // rowspan="0" means "to the end of the section"; treat as the rest of the table.
      const rowspan = cell.rowSpan === 0 ? rows.length - r : Math.min(Math.max(cell.rowSpan || 1, 1), MAX_SPAN);
      for (let dr = 0; dr < rowspan && r + dr < rows.length; dr++) {
        for (let dc = 0; dc < colspan; dc++) grid[r + dr]![c + dc] = cell;
      }
      c += colspan;
    }
  });
  return grid;
};

/** Most common row width (widest on ties); one malformed row must not reshape the table. */
const modalWidth = (grid: readonly (readonly unknown[])[]): number => {
  const counts = new Map<number, number>();
  for (const g of grid) counts.set(g.length, (counts.get(g.length) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [w, n] of counts) {
    if (n > bestCount || (n === bestCount && w > best)) {
      best = w;
      bestCount = n;
    }
  }
  return best;
};

const withoutFootnotes = (s: string) => s.replace(/\[[^\]]{1,6}\]/g, "").trim();

/** A body cell repeats its column header if it equals the header or one of its stacked parts. */
const repeatsHeader = (cell: string, header: string): boolean => {
  const c = withoutFootnotes(cell);
  const h = withoutFootnotes(header);
  return c === h || h.split(": ").some((part) => withoutFootnotes(part) === c);
};

const isHeaderRow = (row: HTMLTableRowElement): boolean =>
  row.parentElement?.tagName === "THEAD" ||
  (row.cells.length > 0 && Array.from(row.cells).every((c) => c.tagName === "TH"));

/** Nearest heading before the table in document order. */
const precedingHeading = (table: Element, headings: readonly Element[]): string | null => {
  let best: Element | null = null;
  for (const h of headings) {
    if (h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
    else break;
  }
  return best === null ? null : cellText(best as HTMLElement) || null;
};

const isLayoutTable = (table: HTMLTableElement): boolean =>
  table.getAttribute("role") === "presentation" ||
  table.querySelector("table") !== null ||
  table.closest("[contenteditable=true]") !== null;

export const extractTable = (
  table: HTMLTableElement,
  id: string,
  headings: readonly Element[],
): ExtractedTable | null => {
  if (isLayoutTable(table)) return null;
  // Rows with no cells (StatCan puts one between header and body) carry nothing.
  const rows = Array.from(table.rows).filter((r) => r.closest("table") === table && r.cells.length > 0);
  if (rows.length < 2) return null;
  const grid = buildGrid(rows);
  const width = modalWidth(grid);
  if (width < 2) return null;

  // Header rows: the leading run of thead / all-<th> rows; else the first row.
  let headerCount = 0;
  while (headerCount < rows.length - 1 && isHeaderRow(rows[headerCount]!)) headerCount++;
  if (headerCount === 0) headerCount = 1;
  // Units rows written as <td> ("Percent", "Index") under the real header:
  // leading rows with no numbers, directly above rows that have them.
  const hasNumber = (r: number) => (grid[r] ?? []).some((cell) => parseNumber(cellText(cell)) !== null);
  for (let extra = 0; extra < 2 && headerCount < rows.length - 2; extra++) {
    const r = headerCount;
    const row = grid[r] ?? [];
    const texts = row.map((cell) => cellText(cell));
    // Section labels ("Pre-cycle sets") are one cell spanning the row; units rows are short distinct cells.
    const distinctCells = new Set(row).size;
    if (distinctCells < 2 || texts.some((t) => t.length > 30)) break;
    if (hasNumber(r) || texts.every((t) => t === "") || !hasNumber(r + 1)) break;
    headerCount++;
  }

  const headers = Array.from({ length: width }, (_, c) => {
    const parts: string[] = [];
    for (let r = 0; r < headerCount; r++) {
      const cell = grid[r]![c];
      const t = cell === undefined ? "" : cellText(cell);
      if (t !== "" && parts.at(-1) !== t) parts.push(t);
    }
    return parts.join(": ");
  });
  const headerCells = Array.from({ length: width }, (_, c) => grid[headerCount - 1]![c] ?? null);

  const dataRows: HTMLTableCellElement[][] = [];
  const texts: string[][] = [];
  for (let r = headerCount; r < rows.length; r++) {
    const row = rows[r]!;
    const g = grid[r]!;
    if (row.parentElement?.tagName === "TFOOT") continue;
    // Section labels: one cell spanning (nearly) the whole row.
    if (new Set(g).size === 1 && width > 2) continue;
    if (g.length < width) continue;
    const cellsInRow = g.slice(0, width);
    const text = cellsInRow.map((cell) => cellText(cell));
    // Repeated header rows inside tbody (baseball-reference every 20 rows, Wikipedia at the foot).
    if (isHeaderRow(row) && text.every((t, c) => repeatsHeader(t, headers[c] ?? ""))) continue;
    if (row.classList.contains("thead")) continue;
    dataRows.push(cellsInRow);
    texts.push(text);
  }
  if (dataRows.length === 0) return null;

  const caption = table.caption === null ? "" : cellText(table.caption);
  return {
    element: table,
    axis: "columns",
    snapshot: {
      id,
      title: caption !== "" ? caption : precedingHeading(table, headings),
      headers,
      rows: texts,
    },
    cells: dataRows,
    headerCells,
  };
};

/**
 * The same table seen row-wise: original row j is column j + 1, and the
 * row-label cells become the headers that carry legends.
 */
export const transposeExtracted = (t: ExtractedTable): ExtractedTable => {
  const width = t.snapshot.headers.length;
  return {
    element: t.element,
    axis: "rows",
    snapshot: transposeSnapshot(t.snapshot),
    cells: Array.from({ length: width - 1 }, (_, i) => [
      t.headerCells[i + 1] ?? t.cells[0]![i + 1]!,
      ...t.cells.map((row) => row[i + 1]!),
    ]),
    headerCells: [t.headerCells[0] ?? null, ...t.cells.map((row) => row[0] ?? null)],
  };
};

/**
 * Every <table> element, and snapshots for those `include` accepts (all, by
 * default). Ids are document order among all tables, so they don't depend on
 * which ones were included.
 */
export const extractPage = (
  doc: Document,
  include: (table: HTMLTableElement) => boolean = () => true,
): { page: PageSnapshot; tables: ExtractedTable[]; elements: HTMLTableElement[] } => {
  const elements = Array.from(doc.querySelectorAll("table"));
  const wanted = elements.map((t, i) => [t, i] as const).filter(([t]) => include(t));
  const headings = wanted.length === 0 ? [] : Array.from(doc.querySelectorAll("h1, h2, h3, h4"));
  const tables = wanted
    .map(([t, i]) => extractTable(t, `t${i}`, headings))
    .filter((t): t is ExtractedTable => t !== null);
  return {
    page: { url: doc.location?.href ?? "", title: doc.title, tables: tables.map((t) => t.snapshot) },
    tables,
    elements,
  };
};
