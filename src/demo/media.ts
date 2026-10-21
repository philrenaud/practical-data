/**
 * Bundle for scripts/readme-media.ts. It sets `globalThis.__media`, which
 * gives Playwright the extractor and the painter.
 */
import type { Palette } from "../core/scale.ts";
import type { PageJudgment } from "../core/types.ts";
import { extractPage, transposeExtracted } from "../dom/extract.ts";
import { paintTable } from "../dom/paint.ts";

(globalThis as { __media?: unknown }).__media = {
  snapshot: () => extractPage(document).page,
  /** Paints the tables marked data-paint. The other tables, such as a "Before" table, stay plain. */
  paint: (judgment: PageJudgment, palette: Palette) => {
    const { tables } = extractPage(document);
    const groups = new Map<string, number>();
    for (const t of judgment.tables) {
      for (const e of t.encodings) if (e.group !== null) groups.set(e.group, (groups.get(e.group) ?? 0) + 1);
    }
    for (const t of judgment.tables) {
      const table = tables.find((x) => x.snapshot.id === t.id);
      if (table?.element.hasAttribute("data-paint")) {
        paintTable(t.orientation === "rows" ? transposeExtracted(table) : table, t, palette, groups);
      }
    }
  },
};
