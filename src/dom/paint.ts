/**
 * Paints judgments onto live tables with d3-selection. All page mutations are
 * reversible: original inline styles are stashed and restored by `unpaint`.
 * Colored columns are marked by a gradient underline on the header cell; the
 * hover card lives in a shadow root so page CSS can't reach it.
 */
import { select, selectAll } from "d3-selection";
import { describeColumn, type Legend } from "../core/legend.ts";
import { positions, schemeColor, type Palette } from "../core/scale.ts";
import { cellFill, isDark, luminance } from "../core/tint.ts";
import type { ColumnEncoding, TableJudgment } from "../core/types.ts";
import type { Orientation } from "../core/orient.ts";
import { resolveColor } from "./color.ts";
import type { ExtractedTable } from "./extract.ts";

// ── Color helpers ───────────────────────────────────────────────────────────

/**
 * Background behind a cell. Starts at the row, not the cell: the cell's own
 * background (e.g. Wikipedia's bgcolor category colors) is what gets replaced.
 * Rows are cached per paint pass: every cell in a row shares the answer.
 */
const backgroundOf = (start: Element | null): string => {
  for (let node = start; node !== null; node = node.parentElement) {
    const c = resolveColor(getComputedStyle(node).backgroundColor);
    if (c.alpha > 0.5) return c.rgb;
  }
  return "rgb(255, 255, 255)";
};

const effectiveBackground = (cell: Element, rows?: Map<Element, string>): string => {
  const row = cell.parentElement;
  if (rows === undefined || row === null) return backgroundOf(row);
  const hit = rows.get(row);
  if (hit !== undefined) return hit;
  const bg = backgroundOf(row);
  rows.set(row, bg);
  return bg;
};

// ── Reversible styles ───────────────────────────────────────────────────────

/**
 * Original inline values of the properties we set, per element. Restoring
 * only these (rather than the whole style string) keeps whatever the page
 * itself changed after we painted, such as a sticky column's `left`.
 */
const originals = new WeakMap<
  HTMLElement,
  { attr: string | null; props: Map<string, [string, string]> }
>();
const STYLED = "pdStyled";

const setStyle = (el: HTMLElement, prop: string, value: string) => {
  let entry = originals.get(el);
  if (entry === undefined) {
    // style="" means the same as no attribute; record it as none so restoring never writes one.
    const attr = el.getAttribute("style");
    entry = { attr: attr === null || attr.trim() === "" ? null : attr, props: new Map() };
    originals.set(el, entry);
    el.dataset[STYLED] = "";
  }
  if (!entry.props.has(prop)) entry.props.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
  el.style.setProperty(prop, value, "important");
};

/** Declarations other than `skip`, as "name:value!priority" strings, sorted. */
const declarations = (style: CSSStyleDeclaration, skip: ReadonlySet<string>): string => {
  const out: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if ([...skip].some((p) => name === p || name.startsWith(`${p}-`))) continue;
    out.push(`${name}:${style.getPropertyValue(name)}!${style.getPropertyPriority(name)}`);
  }
  return out.sort().join(";");
};

let probe: HTMLElement | null = null;

const restoreStyles = (el: HTMLElement) => {
  const entry = originals.get(el);
  if (entry !== undefined) {
    // If the page changed nothing else since we painted, put back the original
    // attribute in one step. Removing properties first leaves Chrome's lazily
    // synced style attribute able to reappear as style="".
    probe ??= document.createElement("div");
    probe.setAttribute("style", entry.attr ?? "");
    const ours = new Set(entry.props.keys());
    if (declarations(el.style, ours) === declarations(probe.style, ours)) {
      // setAttribute first: after CSSOM writes, Chrome syncs the declaration block
      // back into the attribute lazily, so a bare removeAttribute leaves style="".
      el.setAttribute("style", entry.attr ?? "");
      if (entry.attr === null) el.removeAttribute("style");
    } else {
      for (const [prop, [value, priority]] of entry.props) {
        if (value === "") el.style.removeProperty(prop);
        else el.style.setProperty(prop, value, priority);
      }
      if (entry.attr === null && el.style.length === 0) {
        el.setAttribute("style", "");
        el.removeAttribute("style");
      }
    }
    originals.delete(el);
  }
  delete el.dataset[STYLED];
};

// ── Cells ───────────────────────────────────────────────────────────────────

const paintColumn = (
  table: ExtractedTable,
  encoding: ColumnEncoding,
  palette: Palette,
  excluded: ReadonlySet<number>,
  rows: Map<Element, string>,
) => {
  const ts = positions(encoding, excluded);
  const cells = table.cells.map((row) => row[encoding.col]!);
  // Spanned cells repeat in the grid; paint each element once (first row wins).
  const seen = new Set<HTMLTableCellElement>();
  const unique = cells.flatMap((cell, row) => {
    if (seen.has(cell)) return [];
    seen.add(cell);
    return [{ cell, t: ts[row] ?? null }];
  });

  selectAll<HTMLTableCellElement, (typeof unique)[number]>(unique.map((u) => u.cell))
    .data(unique)
    .each(function (d) {
      if (d.t === null) {
        this.dataset["pdT"] = "";
        return;
      }
      const base = effectiveBackground(this, rows);
      const { color, weight } = schemeColor(encoding, palette, d.t, isDark(base));
      const { fill, text } = cellFill(color, weight, base, resolveColor(getComputedStyle(this).color).rgb);
      setStyle(this, "background-color", fill);
      if (text !== null) setStyle(this, "color", text);
      select(this).attr("data-pd-t", d.t.toFixed(3)).attr("data-pd-col", encoding.col);
    });
};

// ── Header underline + hover card ───────────────────────────────────────────

const gradient = (stops: readonly string[], direction = "90deg") =>
  `linear-gradient(${direction}, ${stops.map((x, i) => `${x} ${(i / (stops.length - 1)) * 100}%`).join(", ")})`;

const UNDERLINE_PX = 3;

/**
 * Marks a colored column by drawing its gradient along the bottom of the
 * header cell, as an extra background layer in front of the header's own
 * (Wikipedia's sort arrows are background images). Adds no element, so the
 * column's width and the label's alignment can't change.
 */
const underline = (header: HTMLElement, stops: readonly string[], axis: Orientation) => {
  const cs = getComputedStyle(header);
  // A hairline above the gradient keeps its pale end visible on a matching background.
  const own = resolveColor(cs.backgroundColor);
  const behind = own.alpha > 0.5 ? own.rgb : effectiveBackground(header);
  const edge = luminance(behind) < 0.2 ? "rgb(255 255 255 / 0.4)" : "rgb(0 0 0 / 0.3)";
  // Columns: a bar along the header's bottom. Rows: along the row label's right edge.
  const layers =
    axis === "columns"
      ? [
          { image: `linear-gradient(${edge}, ${edge})`, size: "100% 1px", position: `0 calc(100% - ${UNDERLINE_PX}px)` },
          { image: gradient(stops), size: `100% ${UNDERLINE_PX}px`, position: "0 100%" },
        ]
      : [
          { image: `linear-gradient(${edge}, ${edge})`, size: "1px 100%", position: `calc(100% - ${UNDERLINE_PX}px) 0` },
          { image: gradient(stops, "180deg"), size: `${UNDERLINE_PX}px 100%`, position: "100% 0" },
        ];
  const keep = cs.backgroundImage !== "none";
  const set = (prop: string, ours: string, theirs: string) => setStyle(header, prop, keep ? `${ours}, ${theirs}` : ours);
  set("background-image", layers.map((l) => l.image).join(", "), cs.backgroundImage);
  set("background-size", layers.map((l) => l.size).join(", "), cs.backgroundSize);
  set("background-position", layers.map((l) => l.position).join(", "), cs.backgroundPosition);
  set("background-repeat", layers.map(() => "no-repeat").join(", "), cs.backgroundRepeat);
};

const CARD_CSS = `
:host { all: initial; }
.card {
  position: fixed; z-index: 2147483646; pointer-events: none;
  width: 240px; padding: 12px 14px;
  border-radius: 12px; background: rgb(22 22 26 / 0.97); color: #f3f1ec;
  font: 13px/1.5 "Bricolage Grotesque", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.06) inset, 0 14px 36px rgb(0 0 0 / 0.3);
  opacity: 0; transform: translateY(4px); transition: opacity 120ms ease-out, transform 120ms ease-out;
}
.card.open { opacity: 1; transform: none; }
.section + .section { margin-top: 14px; padding-top: 14px; border-top: 1px solid rgb(255 255 255 / 0.1); }
.title { font-weight: 650; font-size: 14px; }
.status { margin: 2px 0 10px; font-size: 12px; letter-spacing: 0.02em; color: #c9c3b8; }
.ramp { height: 8px; border-radius: 4px; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.14); }
.ends { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; font: 12px ui-monospace, "IBM Plex Mono", monospace; color: #e2ddd3; }
.fact { margin-top: 8px; font-size: 12px; color: #a7a196; }
.fact + .fact { margin-top: 2px; }
`;

let card: { host: HTMLElement; el: HTMLDivElement } | null = null;
let scrollWatched = false;

const ensureCard = () => {
  if (card !== null && card.host.isConnected) return card;
  const host = document.createElement("span");
  host.setAttribute("data-pd-card", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CARD_CSS}</style><div class="card" role="tooltip"></div>`;
  document.documentElement.append(host);
  card = { host, el: root.querySelector(".card")! };
  if (!scrollWatched) addEventListener("scroll", hideCard, { passive: true, capture: true });
  scrollWatched = true;
  return card;
};

const showCard = (anchor: Element, legends: readonly Legend[]) => {
  const { el } = ensureCard();
  const box = select(el);
  box.selectAll("*").remove();
  const section = box.selectAll(".section").data(legends).join("div").attr("class", "section");
  section.append("div").attr("class", "title").text((d) => d.title);
  section.append("div").attr("class", "status").text((d) => d.status);
  section.append("div").attr("class", "ramp").style("background", (d) => gradient(d.stops));
  const ends = section.append("div").attr("class", "ends");
  ends.append("span").text((d) => d.lo);
  ends.append("span").text((d) => d.hi);
  section
    .selectAll(".fact")
    .data((d) => d.facts)
    .join("div")
    .attr("class", "fact")
    .text((d) => d);

  const r = anchor.getBoundingClientRect();
  const width = 240;
  const height = el.offsetHeight || 180;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), innerWidth - width - 8);
  const below = r.bottom + 8;
  el.style.left = `${left}px`;
  el.style.top = below + height > innerHeight ? `${Math.max(8, r.top - height - 8)}px` : `${below}px`;
  el.classList.add("open");
};

function hideCard() {
  card?.el.classList.remove("open");
}

const LONG_PRESS_MS = 450;
const detach = new WeakMap<HTMLElement, () => void>();

/** Mouse: hover the header. Touch and pen: press and hold, so a tap still sorts. */
const attachCard = (header: HTMLElement, legends: readonly Legend[]) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => showCard(header, legends);
  const enter = (ev: PointerEvent) => ev.pointerType === "mouse" && open();
  const leave = (ev: PointerEvent) => ev.pointerType === "mouse" && hideCard();
  const down = (ev: PointerEvent) => {
    if (ev.pointerType !== "mouse") timer = setTimeout(open, LONG_PRESS_MS);
  };
  const up = () => clearTimeout(timer);
  header.addEventListener("pointerenter", enter);
  header.addEventListener("pointerleave", leave);
  header.addEventListener("pointerdown", down);
  header.addEventListener("pointerup", up);
  header.addEventListener("pointercancel", up);
  header.dataset["pdLegend"] = legends.map((l) => l.title).join("|");
  detach.set(header, () => {
    header.removeEventListener("pointerenter", enter);
    header.removeEventListener("pointerleave", leave);
    header.removeEventListener("pointerdown", down);
    header.removeEventListener("pointerup", up);
    header.removeEventListener("pointercancel", up);
    delete header.dataset["pdLegend"];
  });
};

// ── Public API ──────────────────────────────────────────────────────────────

export const paintTable = (
  table: ExtractedTable,
  judgment: TableJudgment,
  palette: Palette,
  groupSizes: ReadonlyMap<string, number>,
) => {
  const excluded = new Set(judgment.aggregateRows);
  const aggregates = judgment.aggregateRows.map((r) => table.snapshot.rows[r]?.[0] ?? "").filter((x) => x !== "");
  // A spanning header can sit over several encoded columns; it gets one card listing each.
  const byHeader = new Map<HTMLTableCellElement, Legend[]>();
  const rows = new Map<Element, string>();
  for (const e of judgment.encodings) {
    paintColumn(table, e, palette, excluded, rows);
    const header = table.headerCells[e.col];
    if (header == null) continue;
    const behind = header == null ? "rgb(255, 255, 255)" : effectiveBackground(header);
    const legend = describeColumn(e, palette, isDark(behind), {
      sharedWith: e.group === null ? 1 : (groupSizes.get(e.group) ?? 1),
      aggregates,
    });
    byHeader.set(header, [...(byHeader.get(header) ?? []), legend]);
  }
  for (const [header, legends] of byHeader) {
    underline(header, legends[0]!.stops, table.axis);
    attachCard(header, legends);
  }
  table.element.dataset["pdTable"] = judgment.id;
  table.element.dataset["pdOrientation"] = judgment.orientation;
  table.element.dataset["pdEncoded"] = judgment.encodings
    .map((e) =>
      e.kind === "quantitative" ? `${e.col}:${e.polarity}:${e.transform}` : `${e.col}:ordinal:${e.order.join(">")}`,
    )
    .join("|");
};

export const unpaint = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLElement>("[data-pd-legend]").forEach((el) => detach.get(el)?.());
  root.querySelectorAll<HTMLElement>("[data-pd-styled], [data-pd-t]").forEach((el) => {
    restoreStyles(el);
    delete el.dataset["pdT"];
    delete el.dataset["pdCol"];
  });
  root.querySelectorAll<HTMLElement>("[data-pd-table]").forEach((el) => {
    delete el.dataset["pdTable"];
    delete el.dataset["pdEncoded"];
    delete el.dataset["pdOrientation"];
  });
  hideCard();
};
