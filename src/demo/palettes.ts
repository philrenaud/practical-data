/** Palette study: every diverging palette on the same tables, light and dark. */
import { select } from "d3-selection";
import { PALETTES, type PaletteId } from "../core/palettes.ts";
import type { PageJudgment, PageSnapshot } from "../core/types.ts";
import { extractTable } from "../dom/extract.ts";
import { paintTable } from "../dom/paint.ts";
import data from "../../demo/data.json" with { type: "json" };

interface DemoSection {
  readonly section: { id: string };
  readonly page: PageSnapshot;
  readonly judgment: PageJudgment;
}
const sections = data as unknown as readonly DemoSection[];
const pick = (id: string, table: number, rows: number) => {
  const s = sections.find((x) => x.section.id === id)!;
  const t = s.page.tables[table]!;
  return { table: { ...t, rows: t.rows.slice(0, rows) }, judgment: s.judgment.tables[table]!, full: t };
};
const samples = [pick("pricing", 0, 8), pick("pitching", 0, 7)];

const main = select("#study");
for (const [id, spec] of Object.entries(PALETTES) as [PaletteId, (typeof PALETTES)[PaletteId]][]) {
  const section = main.append("section").attr("class", "palette").attr("id", id);
  section.append("h2").text(spec.label);
  section.append("p").attr("class", "note").text(spec.note);
  const panels = section.append("div").attr("class", "panels");
  for (const theme of ["light", "dark"] as const) {
    const panel = panels.append("div").attr("class", `panel ${theme}`);
    panel.append("h3").text(theme);
    for (const [i, s] of samples.entries()) {
      const table = panel.append("table");
      table.append("thead").append("tr").selectAll("th").data(s.table.headers).join("th").text((d) => d);
      table.append("tbody").selectAll("tr").data(s.table.rows).join("tr").selectAll("td").data((r) => r).join("td").text((d) => d);
      const extracted = extractTable(table.node()!, `${id}-${theme}-${i}`, []);
      if (extracted === null) continue;
      // Positions come from the full table's judgment; trim its values to the rows shown.
      const judgment = {
        ...s.judgment,
        encodings: s.judgment.encodings.map((e) => ({ ...e, values: e.values.slice(0, s.table.rows.length) })),
      } as typeof s.judgment;
      paintTable(extracted, judgment, id, new Map());
    }
  }
}
