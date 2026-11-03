/**
 * Reorders a table's data rows by parsed values, and restores the page's own
 * order. Rows move between fixed slots, so rows that must not move — repeated
 * header rows inside the body, totals, section labels — stay where they are.
 * The caller pauses its mutation observer around these calls.
 */

export interface SortState {
  /** The column being sorted, as an index into the snapshot's headers, or null for the page's order. */
  readonly col: number | null;
  readonly dir: "asc" | "desc";
}

/** The sortable rows in their original page order, captured before the first move. */
const originals = new WeakMap<HTMLTableElement, readonly HTMLTableRowElement[]>();

/**
 * A table can be sorted when every data row can move as one unit: no cell
 * spans rows, and each row is a <tr> of its own.
 */
export const canSortRows = (rows: readonly (readonly HTMLElement[])[]): boolean =>
  rows.length > 1 &&
  rows.every((cells) => {
    const tr = cells[0]?.closest("tr");
    return (
      tr !== null &&
      tr !== undefined &&
      cells.every((cell) => cell.closest("tr") === tr && (cell as HTMLTableCellElement).rowSpan <= 1)
    );
  });

const rowOf = (cells: readonly HTMLElement[]): HTMLTableRowElement => cells[0]!.closest("tr")!;

/**
 * Moves the given rows into the order `ranks` describes: rows are placed into
 * the document slots the movable rows occupy now, so fixed rows in between
 * keep their positions. `movable[i]` gets rank `ranks[i]`; lower ranks come
 * first.
 */
const placeInSlots = (movable: readonly HTMLTableRowElement[], order: readonly HTMLTableRowElement[]) => {
  const slots = movable.map((tr) => {
    const slot = document.createComment("");
    tr.before(slot);
    tr.remove();
    return slot;
  });
  slots.forEach((slot, i) => {
    slot.replaceWith(order[i]!);
  });
};

/**
 * Sorts the table's movable data rows by `keys`. A null key (a missing or
 * unparseable cell) sorts after every value in either direction. `pinned` rows
 * (totals) do not move. Returns false when the rows cannot be reordered.
 */
export const sortRows = (
  table: HTMLTableElement,
  rows: readonly (readonly HTMLElement[])[],
  keys: readonly (number | null)[],
  pinned: ReadonlySet<number>,
  dir: "asc" | "desc",
): boolean => {
  if (!canSortRows(rows)) return false;
  const movableIdx = rows.map((_, i) => i).filter((i) => !pinned.has(i));
  const movable = movableIdx.map((i) => rowOf(rows[i]!));
  if (originals.get(table) === undefined) originals.set(table, movable);
  const sign = dir === "asc" ? 1 : -1;
  const order = movableIdx
    .map((i, m) => ({ tr: movable[m]!, key: keys[i] ?? null, tie: m }))
    .sort((a, b) => {
      if (a.key === null && b.key === null) return a.tie - b.tie;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return (a.key - b.key) * sign || a.tie - b.tie;
    })
    .map((e) => e.tr);
  placeInSlots(movable, order);
  return true;
};

/** Puts the rows back in the page's own order. True when there was a sort to undo. */
export const restoreRows = (table: HTMLTableElement): boolean => {
  const original = originals.get(table);
  if (original === undefined) return false;
  originals.delete(table);
  const connected = original.filter((tr) => tr.isConnected);
  if (connected.length !== original.length) return false;
  placeInSlots(
    [...connected].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)),
    original,
  );
  return true;
};
