/**
 * Reads tables from the DOM into TableSnapshot objects. The extractor expands
 * rowspan and colspan into a rectangular grid, so a column index names the
 * same column on every row. It also keeps a grid of the cell elements for the
 * painter.
 */
import { transposeSnapshot, type Orientation } from "../core/orient.ts";
import { parseNumber } from "../core/parse.ts";
import type { PageSnapshot, TableSnapshot } from "../core/types.ts";

export interface ExtractedTable {
  readonly element: HTMLTableElement;
  /** "rows" when the table is transposed. Then each column is one row of the original table. */
  readonly axis: Orientation;
  readonly snapshot: TableSnapshot;
  /** `cells[row][col]`, aligned with `snapshot.rows`. Spanned cells repeat. */
  readonly cells: readonly (readonly HTMLTableCellElement[])[];
  /** The lowest header cell of each column. The painter attaches legends to these cells. */
  readonly headerCells: readonly (HTMLTableCellElement | null)[];
}

/** The largest span the grid honors. Browsers allow colspan up to 1000 and rowspan up to 65534. */
const MAX_SPAN = 64;

/**
 * Controls inside cells and captions ("show", sort buttons, Wikipedia's
 * "v t e" template links) are not part of the data.
 */
const CONTROLS = "button, [role=button], .mw-collapsible-toggle, .navbar.plainlinks, select, input";

const textOf = (el: HTMLElement): string =>
  // innerText honors display:none, which hides Wikipedia's sort keys.
  (el.isConnected && typeof el.innerText === "string" ? el.innerText : el.textContent) ?? "";

/**
 * True for a superscript that annotates the cell instead of holding data, such
 * as a footnote link (Wikipedia, Statistics Canada) or a quality flag of one
 * or two letters ("74.3ʳ"). Exponents such as km² have no link and are
 * digits, so they are kept.
 */
const isAnnotation = (sup: HTMLElement): boolean =>
  sup.querySelector("a") !== null || /^\s*(?:[A-Za-z]{1,2}|\[[^\]]*\])\s*$/.test(sup.textContent ?? "");

const BREAKS = new Set(["block", "list-item", "table-cell", "table-row", "flex", "grid"]);

/**
 * Returns the visible text of a cell without the elements in `skip`. It walks
 * the nodes because removing an annotation's text by string match also
 * removes that letter elsewhere in the cell ("American" becomes "Americn" when
 * the footnote is "a").
 */
const textSkipping = (cell: HTMLElement, skip: ReadonlySet<Element>): string => {
  let out = "";
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? "";
      } else if (child instanceof HTMLElement && skip.has(child)) {
        // Screen-reader text can be the only thing between two numbers, as in
        // a fraction template's "8<span>+</span>1⁄2". Keep them apart.
        if (child.matches(SCREEN_READER_ONLY)) out += " ";
      } else if (child instanceof HTMLElement) {
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

/** Class names that sites use for text meant only for screen readers. */
const SCREEN_READER_ONLY =
  '[class*="sr-only"], [class*="visually-hidden"], [class*="visuallyhidden" i], [class*="screen-reader"], [class*="offscreen" i]';

/**
 * True for text kept for screen readers and clipped out of view, such as
 * "This row is clickable" after a balance. innerText keeps it, because it is
 * rendered. It needs the class name and a box of a pixel or less, which is how
 * such classes hide text.
 */
const isScreenReaderOnly = (el: HTMLElement): boolean => {
  if (!el.isConnected) return false;
  const position = getComputedStyle(el).position;
  if (position !== "absolute" && position !== "fixed") return false;
  const box = el.getBoundingClientRect();
  return box.width <= 1 && box.height <= 1;
};

/**
 * True for a cell the page hides while its row shows, such as a column kept
 * for narrow screens. innerText returns the text of an element that is not
 * rendered, so the hidden column would read as data. A collapsed table hides
 * whole rows, which this leaves alone.
 */
const isHiddenCell = (cell: HTMLElement): boolean =>
  (cell.tagName === "TD" || cell.tagName === "TH") &&
  cell.isConnected &&
  !cell.checkVisibility() &&
  cell.parentElement?.checkVisibility() === true;

/**
 * True for a button whose whole text is a number, such as a price that opens
 * a popover with its terms. The number is the cell's value, not a control.
 */
const holdsValue = (el: HTMLElement): boolean =>
  el.matches("button, [role=button]") && parseNumber(el.textContent ?? "") !== null;

const cellText = (cell: HTMLElement, keepButtons = false): string => {
  if (isHiddenCell(cell)) return "";
  const noise =
    cell.firstElementChild === null
      ? []
      : [
          ...[...cell.querySelectorAll<HTMLElement>(CONTROLS)].filter(
            (el) => !holdsValue(el) && !(keepButtons && el.matches("button, [role=button]")),
          ),
          ...[...cell.querySelectorAll<HTMLElement>("sup")].filter(isAnnotation),
          ...[...cell.querySelectorAll<HTMLElement>(SCREEN_READER_ONLY)].filter(isScreenReaderOnly),
        ];
  const text = noise.length === 0 ? textOf(cell) : textSkipping(cell, new Set(noise));
  return text.replace(/\s+/g, " ").trim();
};

/**
 * A header cell's label. A sortable header often puts its whole label in the
 * sort button ("<th><button>Speed</button></th>"), and dropping buttons as
 * controls leaves it empty. When nothing else is left, the button's text is
 * the label. Body cells still drop buttons such as Edit.
 */
const headerText = (cell: HTMLElement): string => cellText(cell) || cellText(cell, true);

/** Expands spans so grid[r][c] is the cell covering that slot. */
const buildGrid = (rows: readonly HTMLTableRowElement[]): HTMLTableCellElement[][] => {
  const grid: HTMLTableCellElement[][] = rows.map(() => []);
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of Array.from(row.cells)) {
      while (grid[r]![c] !== undefined) c++;
      const colspan = Math.min(Math.max(cell.colSpan || 1, 1), MAX_SPAN);
      // rowspan="0" spans to the end of the row group. The grid treats it as the rest of the table.
      const rowspan = cell.rowSpan === 0 ? rows.length - r : Math.min(Math.max(cell.rowSpan || 1, 1), MAX_SPAN);
      for (let dr = 0; dr < rowspan && r + dr < rows.length; dr++) {
        for (let dc = 0; dc < colspan; dc++) grid[r + dr]![c + dc] = cell;
      }
      c += colspan;
    }
  });
  return grid;
};

/**
 * True when slots 0 to width - 1 all hold a cell. A row with fewer cells than
 * a rowspan above it reaches has a hole in the middle, not just a short end.
 */
const isFull = (row: readonly (HTMLTableCellElement | undefined)[], width: number): boolean => {
  for (let c = 0; c < width; c++) if (row[c] === undefined) return false;
  return true;
};

/** Returns the most common row width, or the widest on a tie, so one malformed row does not set the width. */
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

/** The shape of a cell's text. Each run of letters becomes "a" and each run of digits becomes "9". */
const shapeOf = (text: string): string =>
  text
    .replace(/\p{L}+/gu, "a")
    .replace(/\d+/g, "9")
    .replace(/\s+/g, " ")
    .trim();

const isBold = (cell: HTMLTableCellElement): boolean => {
  if (!cell.isConnected) return cell.querySelector("b, strong") !== null;
  return Number.parseInt(getComputedStyle(cell).fontWeight, 10) >= 600 || cell.querySelector("b, strong") !== null;
};

/**
 * True when a table without <th> or <thead> starts with a data row. Each cell
 * of such a row has the shape of some cell below it, and no cell is bold.
 * "Atlanta Braves | (94-68)" over "Miami Marlins | (80-82)" is data. "Team |
 * W-L" over the same rows is a header.
 */
const looksLikeData = (grid: readonly (readonly HTMLTableCellElement[])[], width: number): boolean => {
  const first = grid[0];
  const body = grid.slice(1).filter((g) => isFull(g, width));
  if (first === undefined || !isFull(first, width) || body.length === 0) return false;
  for (let c = 0; c < width; c++) {
    const cell = first[c]!;
    if (isBold(cell)) return false;
    const shape = shapeOf(cellText(cell));
    if (!body.some((g) => shapeOf(cellText(g[c]!)) === shape)) return false;
  }
  return true;
};

/**
 * True when one cell spans the row, or all of it but a leading empty cell.
 * Each slot must hold a cell, and the spanning cell must have text.
 */
const isSpanningLabel = (row: readonly (HTMLTableCellElement | undefined)[], width: number): boolean => {
  const cells = [...new Set(row.slice(0, width))];
  if (cells.length === 1) return true;
  const [first, label] = cells;
  return (
    cells.length === 2 &&
    first !== undefined &&
    label !== undefined &&
    row[0] === first &&
    first.colSpan <= 1 &&
    cellText(first) === "" &&
    cellText(label) !== ""
  );
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

/** Elements that make a row something to act on: select, star, open. */
const ROW_CONTROLS = "input[type=checkbox], [role=checkbox], button, [role=button], [role=switch]";

/**
 * True for an app's list of items built as a table, such as a mail inbox. It
 * is marked as a grid, every row has a control, and no row is a header. All
 * three must hold. Many data tables have no header row, and some data grids
 * have a checkbox in every row, but those have headers.
 */
const isAppList = (table: HTMLTableElement, rows: readonly HTMLTableRowElement[]): boolean => {
  const role = table.getAttribute("role");
  if (role !== "grid" && role !== "treegrid") return false;
  if (rows.some(isHeaderRow)) return false;
  return rows.every((r) => r.querySelector(ROW_CONTROLS) !== null);
};

/**
 * True for tables that the extractor skips. Presentation tables and tables
 * that contain tables are layout. Tables in an editable region are skipped
 * because an editor saves the painted inline styles with the document. App
 * lists (see isAppList) are not data to compare.
 */
const isLayoutTable = (table: HTMLTableElement, rows: readonly HTMLTableRowElement[]): boolean =>
  table.getAttribute("role") === "presentation" ||
  table.querySelector("table") !== null ||
  table.isContentEditable ||
  isAppList(table, rows);

/** Reads one table. Returns null for a layout table, or a table with fewer than two rows or columns or no data rows. */
export const extractTable = (
  table: HTMLTableElement,
  id: string,
  headings: readonly Element[],
): ExtractedTable | null => {
  // Rows with no cells (StatCan puts one between header and body) carry nothing.
  const rows = Array.from(table.rows).filter((r) => r.closest("table") === table && r.cells.length > 0);
  if (isLayoutTable(table, rows)) return null;
  if (rows.length < 2) return null;
  const grid = buildGrid(rows);
  const width = modalWidth(grid);
  if (width < 2) return null;

  // The header is the leading rows that are in <thead> or have only <th> cells.
  // Without those, it is the first row, unless that row looks like data (a
  // standings table with no header).
  let headerCount = 0;
  while (headerCount < rows.length - 1 && isHeaderRow(rows[headerCount]!)) headerCount++;
  if (headerCount === 0 && !looksLikeData(grid, width)) headerCount = 1;
  // Units rows written as <td> ("Percent", "Index") sit under the real header.
  // They have no numbers and are directly above a row that has numbers.
  const hasNumber = (r: number) => (grid[r] ?? []).some((cell) => parseNumber(cellText(cell)) !== null);
  for (let extra = 0; extra < 2 && headerCount > 0 && headerCount < rows.length - 2; extra++) {
    const r = headerCount;
    const row = grid[r] ?? [];
    const texts = row.map((cell) => cellText(cell));
    // A section label ("Pre-cycle sets") is one cell that spans the row. A units row has short, distinct cells.
    const distinctCells = new Set(row).size;
    if (distinctCells < 2 || texts.some((t) => t.length > 30)) break;
    if (hasNumber(r) || texts.every((t) => t === "") || !hasNumber(r + 1)) break;
    headerCount++;
  }

  const headers = Array.from({ length: width }, (_, c) => {
    const parts: string[] = [];
    for (let r = 0; r < headerCount; r++) {
      const cell = grid[r]![c];
      const t = cell === undefined ? "" : headerText(cell);
      if (t !== "" && parts.at(-1) !== t) parts.push(t);
    }
    return parts.join(": ");
  });
  const headerCells = Array.from({ length: width }, (_, c) =>
    headerCount === 0 ? null : (grid[headerCount - 1]![c] ?? null),
  );

  const dataRows: HTMLTableCellElement[][] = [];
  const texts: string[][] = [];
  for (let r = headerCount; r < rows.length; r++) {
    const row = rows[r]!;
    const g = grid[r]!;
    if (row.parentElement?.tagName === "TFOOT") continue;
    // Skip section labels, which are one cell that spans the row. Wikipedia's
    // election boxes end with a note ("Party hold") that spans all but an
    // empty color swatch.
    if (width > 2 && isSpanningLabel(g, width)) continue;
    if (!isFull(g, width)) continue;
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
 * Returns the table transposed. Row j of the original becomes column j + 1,
 * and the row-label cells become the header cells that carry legends.
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
 * Returns every <table> element, and snapshots of the tables that `include`
 * accepts (all of them by default). An id is the table's index among all
 * tables in document order, so ids do not depend on which tables `include`
 * accepts.
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
