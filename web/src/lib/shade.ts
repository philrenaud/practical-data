/**
 * Shades a rendered table with the extension's own extractor and painter, so
 * the site shows exactly what the extension does. Repaints when any parameter
 * changes; `theme` is passed only so a page-theme switch repaints too (the
 * painter reads the backgrounds it lands on). An empty `theme` means the
 * page's theme isn't applied yet, so nothing is painted.
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
    // Svelte can reuse this element for a different table (client-side navigation between
    // pages whose tables share ids); a new id means its cells were re-rendered, so read them again.
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
