/**
 * Paints judgments onto live tables. `unpaint` undoes every change that
 * `paintTable` makes, and restores the original value of each inline style
 * property that the painter set. A gradient bar on the header cell marks each
 * shaded column. The hover card is in a shadow root, so page CSS does not
 * reach it.
 */
import { select } from "d3-selection";
import { describeColumn, type Legend } from "../core/legend.ts";
import { positions, schemeColor, type Palette } from "../core/scale.ts";
import { cellFill, isDark, luminance } from "../core/tint.ts";
import type { ColumnEncoding, TableJudgment } from "../core/types.ts";
import type { Orientation } from "../core/orient.ts";
import { resolveColor } from "./color.ts";
import type { ExtractedTable } from "./extract.ts";

// ── Color helpers ───────────────────────────────────────────────────────────

/** The first background at `start` or above it that is more than half opaque, or white. */
const backgroundOf = (start: Element | null): string => {
  for (let node = start; node !== null; node = node.parentElement) {
    const c = resolveColor(getComputedStyle(node).backgroundColor);
    if (c.alpha > 0.5) return c.rgb;
  }
  return "rgb(255, 255, 255)";
};

/**
 * The background behind a cell. The search starts at the row because the
 * shading replaces the cell's own background, such as Wikipedia's bgcolor
 * category colors. `rows` caches the answer for each row during one paint.
 */
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
 * The original inline value of each property the painter set, per element.
 * `unpaint` restores only these properties, not the whole style attribute, so
 * it keeps changes the page made after painting, such as a sticky column's
 * `left`.
 */
const originals = new WeakMap<HTMLElement, { attr: string | null; props: Map<string, [string, string]> }>();
const STYLED = "pdStyled";

const setStyle = (el: HTMLElement, prop: string, value: string) => {
  let entry = originals.get(el);
  if (entry === undefined) {
    // An empty style attribute means the same as none. Record it as none, so a restore never writes one.
    const attr = el.getAttribute("style");
    entry = { attr: attr === null || attr.trim() === "" ? null : attr, props: new Map() };
    originals.set(el, entry);
    el.dataset[STYLED] = "";
  }
  if (!entry.props.has(prop))
    entry.props.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
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
    // If the page changed nothing else after painting, put back the original
    // attribute in one step. After CSSOM writes, Chrome syncs the declarations
    // back into the attribute lazily, so removing properties or the attribute
    // alone can leave style="". Setting the attribute first prevents that.
    probe ??= document.createElement("div");
    probe.setAttribute("style", entry.attr ?? "");
    const ours = new Set(entry.props.keys());
    if (declarations(el.style, ours) === declarations(probe.style, ours)) {
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
  // Spanned cells repeat in the grid. Paint each element once, at the position of its first row.
  const seen = new Set<HTMLTableCellElement>();
  const unique = cells.flatMap((cell, row) => {
    if (seen.has(cell)) return [];
    seen.add(cell);
    return [{ cell, t: ts[row] ?? null }];
  });

  // Read every computed style before the first write. A read after a write
  // forces a style recalculation, so interleaving them makes painting
  // quadratic in the row count.
  const fills = unique.map(({ cell, t }) => {
    if (t === null) return null;
    const base = effectiveBackground(cell, rows);
    const { color, weight } = schemeColor(encoding, palette, t, isDark(base));
    return { t, ...cellFill(color, weight, base, resolveColor(getComputedStyle(cell).color).rgb) };
  });
  unique.forEach(({ cell }, i) => {
    const paint = fills[i];
    if (paint == null) {
      cell.dataset["pdT"] = "";
      return;
    }
    setStyle(cell, "background-color", paint.fill);
    if (paint.text !== null) setStyle(cell, "color", paint.text);
    cell.dataset["pdT"] = paint.t.toFixed(3);
    cell.dataset["pdCol"] = String(encoding.col);
  });
};

// ── Header underline + hover card ───────────────────────────────────────────

const gradient = (stops: readonly string[], direction = "90deg") =>
  `linear-gradient(${direction}, ${stops.map((x, i) => `${x} ${(i / (stops.length - 1)) * 100}%`).join(", ")})`;

const UNDERLINE_PX = 3;

/**
 * Marks a shaded column with its gradient along the bottom of the header cell.
 * The gradient is an extra background layer in front of the header's own
 * layers, so background images such as Wikipedia's sort arrows stay. No
 * element is added, so the column width and the label alignment do not change.
 */
const underline = (header: HTMLElement, stops: readonly string[], axis: Orientation) => {
  const cs = getComputedStyle(header);
  // A hairline above the gradient keeps its pale end visible on a matching background.
  const own = resolveColor(cs.backgroundColor);
  const behind = own.alpha > 0.5 ? own.rgb : effectiveBackground(header);
  const edge = luminance(behind) < 0.2 ? "rgb(255 255 255 / 0.4)" : "rgb(0 0 0 / 0.3)";
  // For columns the bar is along the bottom of the header. For rows it is along the right edge of the row label.
  const layers =
    axis === "columns"
      ? [
          {
            image: `linear-gradient(${edge}, ${edge})`,
            size: "100% 1px",
            position: `0 calc(100% - ${UNDERLINE_PX}px)`,
          },
          { image: gradient(stops), size: `100% ${UNDERLINE_PX}px`, position: "0 100%" },
        ]
      : [
          {
            image: `linear-gradient(${edge}, ${edge})`,
            size: "1px 100%",
            position: `calc(100% - ${UNDERLINE_PX}px) 0`,
          },
          { image: gradient(stops, "180deg"), size: `${UNDERLINE_PX}px 100%`, position: "100% 0" },
        ];
  const keep = cs.backgroundImage !== "none";
  const set = (prop: string, ours: string, theirs: string) =>
    setStyle(header, prop, keep ? `${ours}, ${theirs}` : ours);
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
  // Page rules that match the host (`span { display: block }`) outrank `:host`.
  // An important inline declaration outranks them, so the host takes no space.
  host.style.setProperty("all", "initial", "important");
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
  section
    .append("div")
    .attr("class", "title")
    .text((d) => d.title);
  section
    .append("div")
    .attr("class", "status")
    .text((d) => d.status);
  section
    .append("div")
    .attr("class", "ramp")
    .style("background", (d) => gradient(d.stops));
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

/**
 * Opens the card while the mouse is over the header. With touch or a pen, a
 * press and hold opens it, so a tap still sorts the table.
 */
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
    clearTimeout(timer);
    header.removeEventListener("pointerenter", enter);
    header.removeEventListener("pointerleave", leave);
    header.removeEventListener("pointerdown", down);
    header.removeEventListener("pointerup", up);
    header.removeEventListener("pointercancel", up);
    delete header.dataset["pdLegend"];
  });
};

// ── Public API ──────────────────────────────────────────────────────────────

/** Shades the encoded columns of one table and attaches a legend card to each shaded header. */
export const paintTable = (
  table: ExtractedTable,
  judgment: TableJudgment,
  palette: Palette,
  groupSizes: ReadonlyMap<string, number>,
) => {
  const excluded = new Set(judgment.aggregateRows);
  const aggregates = judgment.aggregateRows.map((r) => table.snapshot.rows[r]?.[0] ?? "").filter((x) => x !== "");
  // A spanning header can be over several shaded columns. It gets one card with a section for each.
  const byHeader = new Map<HTMLTableCellElement, Legend[]>();
  const rows = new Map<Element, string>();
  for (const e of judgment.encodings) {
    paintColumn(table, e, palette, excluded, rows);
    const header = table.headerCells[e.col];
    if (header == null) continue;
    const legend = describeColumn(e, palette, isDark(effectiveBackground(header)), {
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

/** `root` and its descendants that match `selector`. */
const matching = (root: ParentNode, selector: string): HTMLElement[] => [
  ...(root instanceof HTMLElement && root.matches(selector) ? [root] : []),
  ...root.querySelectorAll<HTMLElement>(selector),
];

/** Removes all shading, legends, and data attributes from `root` and its descendants. */
export const unpaint = (root: ParentNode = document) => {
  matching(root, "[data-pd-legend]").forEach((el) => detach.get(el)?.());
  matching(root, "[data-pd-styled], [data-pd-t]").forEach((el) => {
    restoreStyles(el);
    delete el.dataset["pdT"];
    delete el.dataset["pdCol"];
  });
  // The site unpaints one table at a time, so `root` is often the table itself.
  matching(root, "[data-pd-table]").forEach((el) => {
    delete el.dataset["pdTable"];
    delete el.dataset["pdEncoded"];
    delete el.dataset["pdOrientation"];
  });
  hideCard();
};
