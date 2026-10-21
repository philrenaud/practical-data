/**
 * A Svelte action that shades a table with the extension's extractor and
 * painter from src/dom. It repaints when an option changes. The painter does
 * not read `theme`. Pass it so that a theme switch repaints, because the
 * painter blends over the page background. An empty `theme` means the page
 * theme is not applied yet, and the action paints nothing.
 */
import type { Action } from "svelte/action";
import type { PaletteId } from "../../../src/core/palettes.ts";
import type { TableJudgment } from "../../../src/core/types.ts";
import { extractTable, transposeExtracted } from "../../../src/dom/extract.ts";
import { paintTable, unpaint } from "../../../src/dom/paint.ts";

export interface ShadeOptions {
  readonly id: string;
  readonly judgment: TableJudgment;
  readonly palette: PaletteId;
  readonly groupSizes: ReadonlyMap<string, number>;
  readonly colored?: boolean;
  readonly theme?: string;
}

export const shade: Action<HTMLTableElement, ShadeOptions> = (node, options) => {
  let id = options.id;
  let extracted = extractTable(node, id, []);
  const paint = (o: ShadeOptions) => {
    unpaint(node);
    // After client-side navigation, Svelte can reuse this element for a different table.
    // A new id means new cells, so extract the table again.
    if (o.id !== id) {
      id = o.id;
      extracted = extractTable(node, id, []);
    }
    if (extracted === null || o.colored === false || o.theme === "") return;
    paintTable(
      o.judgment.orientation === "rows" ? transposeExtracted(extracted) : extracted,
      o.judgment,
      o.palette,
      o.groupSizes,
    );
  };
  paint(options);
  return { update: paint, destroy: () => unpaint(node) };
};
