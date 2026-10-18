/**
 * Shades a rendered table with the extension's own extractor and painter, so
 * the site shows exactly what the extension does. Repaints when any parameter
 * changes; `theme` is passed only so a page-theme switch repaints too (the
 * painter reads the backgrounds it lands on).
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
  const extracted = extractTable(node, options.id, []);
  const paint = (o: ShadeOptions) => {
    unpaint(node);
    if (extracted === null || o.colored === false) return;
    paintTable(o.judgment.orientation === "rows" ? transposeExtracted(extracted) : extracted, o.judgment, o.palette, o.groupSizes);
  };
  paint(options);
  return { update: paint, destroy: () => unpaint(node) };
};
