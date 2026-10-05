/**
 * Demo site. Renders recorded tables and paints them with the extension's own
 * extractor and painter, using judgments the real pipeline produced
 * (scripts/demo-data.ts). Nothing here calls a model.
 */
import { select } from "d3-selection";
import { DEFAULT_PALETTE, divergingStops, isPaletteId, PALETTES, type PaletteId as Palette } from "../core/palettes.ts";
import type { ColumnEncoding, PageJudgment, PageSnapshot, SkippedColumn, TableSnapshot } from "../core/types.ts";
import { extractTable, transposeExtracted, type ExtractedTable } from "../dom/extract.ts";
import { paintTable, unpaint } from "../dom/paint.ts";
import data from "../../demo/data.json" with { type: "json" };

interface DemoSection {
  readonly section: { id: string; heading: string; source: string; caption: string };
  readonly page: PageSnapshot;
  readonly judgment: PageJudgment;
}

const sections = data as unknown as readonly DemoSection[];

const state: { colored: boolean; palette: Palette } = { colored: true, palette: DEFAULT_PALETTE };
const rendered: { table: ExtractedTable; section: DemoSection; index: number }[] = [];

// ── Plain-language reasons ──────────────────────────────────────────────────

const REASONS: Readonly<Record<string, string>> = {
  "looks like time": "a point in time (year, season, age)",
  "looks like identifier": "an identifier, not an amount",
  "looks like rank": "a rank, not an amount",
  "looks like threshold": "a cutoff, not an amount",
  "labels look like unordered kinds": "labels with no natural order",
  "labels look like names or versions": "names or versions",
  "labels look like workflow states": "stages of a process",
  "labels look like options": "alternative options",
  "every value is unique": "names",
  "too many distinct values": "names or free text",
  "values are long text": "free text",
  "dates or times": "dates",
  "only two levels": "only two levels",
  constant: "every value is the same",
};

const POLARITY: Readonly<Record<ColumnEncoding["polarity"], string>> = {
  higher_is_better: "higher is better",
  lower_is_better: "lower is better",
  neutral: "no better direction",
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

const describeEncoding = (e: ColumnEncoding): string =>
  e.kind === "quantitative"
    ? `${POLARITY[e.polarity]} · ${e.transform} scale${e.group === null ? "" : " · shared"}`
    : `ordered: ${e.order.join(" → ")}`;

const confidenceOf = (e: ColumnEncoding): string =>
  e.kind === "quantitative"
    ? `measure ${pct(e.evidence.comparable)} · direction ${pct(Math.max(...Object.values(e.evidence.polarity)))}`
    : `ordered ${pct(e.evidence.comparable)} · order ${pct(e.evidence.orderConfidence ?? 0)}`;

// ── Rendering ───────────────────────────────────────────────────────────────

const renderTable = (host: HTMLElement, t: TableSnapshot): HTMLTableElement => {
  const table = select(host).append("div").attr("class", "table-scroll").append("table");
  if (t.title !== null) table.append("caption").text(t.title);
  table.append("thead").append("tr").selectAll("th").data(t.headers).join("th").attr("scope", "col").text((d) => d);
  table
    .append("tbody")
    .selectAll("tr")
    .data(t.rows)
    .join("tr")
    .selectAll("td")
    .data((row) => row)
    .join("td")
    .text((d) => d);
  return table.node()!;
};

const renderWhy = (host: HTMLElement, t: TableSnapshot, j: PageJudgment["tables"][number]) => {
  type Row = { header: string; colored: true; e: ColumnEncoding } | { header: string; colored: false; s: SkippedColumn | undefined };
  const rows: Row[] = t.headers.map((header, col) => {
    const e = j.encodings.find((x) => x.col === col);
    return e !== undefined ? { header, colored: true, e } : { header, colored: false, s: j.skipped.find((x) => x.col === col) };
  });
  const list = select(host).append("details").attr("class", "why");
  list.append("summary").text(`How it read ${t.title ?? "this table"}`);
  const items = list.append("ul").selectAll("li").data(rows).join("li").classed("plain", (d) => !d.colored);
  items.append("span").attr("class", "col").text((d) => d.header || "(blank)");
  items
    .append("span")
    .attr("class", "verdict")
    .text((d) => (d.colored ? describeEncoding(d.e) : `left plain: ${REASONS[d.s?.reason ?? ""] ?? d.s?.reason ?? "not comparable"}`));
  items
    .append("span")
    .attr("class", "conf")
    .text((d) => (d.colored ? confidenceOf(d.e) : ""));
  if (j.aggregateRows.length > 0) {
    list.append("p").attr("class", "agg").text(`Rows judged to be totals and kept out of the scale: ${j.aggregateRows.map((r) => `"${t.rows[r]?.[0] ?? r}"`).join(", ")}.`);
  }
};

const paintAll = () => {
  unpaint(document);
  if (!state.colored) return;
  for (const s of sections) {
    const groupSizes = new Map<string, number>();
    for (const t of s.judgment.tables) {
      for (const e of t.encodings) if (e.group !== null) groupSizes.set(e.group, (groupSizes.get(e.group) ?? 0) + 1);
    }
    for (const r of rendered.filter((x) => x.section === s)) {
      const j = s.judgment.tables[r.index]!;
      paintTable(j.orientation === "rows" ? transposeExtracted(r.table) : r.table, j, state.palette, groupSizes);
    }
  }
};

const main = document.querySelector<HTMLElement>("#examples")!;
sections.forEach((s, si) => {
  const article = select(main).append("article").attr("class", "example").attr("id", s.section.id);
  const head = article.append("header");
  head.append("span").attr("class", "index").text(String(si + 1).padStart(2, "0"));
  head.append("h3").text(s.section.heading);
  article.append("p").attr("class", "caption").text(s.section.caption);
  if (s.section.source !== "") {
    article.append("a").attr("class", "source").attr("href", s.section.source).attr("rel", "noopener").text(new URL(s.section.source).hostname.replace(/^www\./, ""));
  } else {
    article.append("span").attr("class", "source").text("synthetic test page");
  }
  s.page.tables.forEach((t, index) => {
    const tableEl = renderTable(article.node()!, t);
    const extracted = extractTable(tableEl, t.id, []);
    if (extracted !== null) rendered.push({ table: extracted, section: s, index });
    renderWhy(article.node()!, t, s.judgment.tables[index]!);
  });
});

// ── Controls ────────────────────────────────────────────────────────────────

const bind = (name: string, apply: (value: string) => void) => {
  document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked) {
        apply(input.value);
        paintAll();
      }
    }),
  );
};
// Palette picker: one option per palette, with the ramp the page's theme will use.
const isDarkPage = () => matchMedia("(prefers-color-scheme: dark)").matches
  ? document.documentElement.dataset["theme"] !== "light"
  : document.documentElement.dataset["theme"] === "dark";
const renderPalettes = () => {
  const dark = isDarkPage();
  const mid = getComputedStyle(document.body).getPropertyValue("--paper").trim() || "#fff";
  select("#palettes")
    .selectAll("label")
    .data(Object.entries(PALETTES) as [Palette, (typeof PALETTES)[Palette]][])
    .join((enter) => {
      const label = enter.append("label").attr("title", ([, p]) => p.note);
      label.append("input").attr("type", "radio").attr("name", "palette").attr("value", ([id]) => id).property("checked", ([id]) => id === state.palette);
      label.append("span").attr("class", "swatch");
      label.append("span").attr("class", "name").text(([, p]) => p.label);
      return label;
    })
    .select(".swatch")
    .style("background", ([id]) => `linear-gradient(90deg, ${divergingStops(id, dark, mid).join(", ")})`);
};
renderPalettes();

bind("view", (v) => (state.colored = v === "colored"));
bind("theme", (v) => {
  if (v === "auto") delete document.documentElement.dataset["theme"];
  else document.documentElement.dataset["theme"] = v;
  renderPalettes();
});
bind("palette", (v) => (state.palette = isPaletteId(v) ? v : DEFAULT_PALETTE));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  renderPalettes();
  paintAll();
});

paintAll();
