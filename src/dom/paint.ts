/**
 * Paints judgments onto live tables. `unpaint` undoes every change that
 * `paintTable` makes, and restores the original value of each inline style
 * property that the painter set. A gradient bar on the header cell marks each
 * shaded column. The hover card is in a shadow root, so page CSS does not
 * reach it. When the caller passes `onRange`, the card of a number column
 * has a slider for the ends of its scale.
 */
import { select } from "d3-selection";
import { describeColumn, withUnit, type Legend } from "../core/legend.ts";
import { isUsableRange, trackPosition, trackValue, type ScaleRange } from "../core/range.ts";
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
    const ink = resolveColor(getComputedStyle(cell).color).rgb;
    return { t, ink, ...cellFill(color, weight, base, ink) };
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
  keepInk(unique.flatMap(({ cell }, i) => (fills[i]?.text === null ? [{ el: cell, ink: fills[i].ink }] : [])));
};

/**
 * Puts back text colors that changed because of the painter's own styles.
 * Some pages color text by the style attribute itself: a dark mode can give
 * any element whose style mentions "background" dark text, to keep inline
 * light backgrounds readable. The fill was chosen for the text color read
 * before painting, so that color is pinned again. All reads happen after all
 * writes, so the page recalculates styles once.
 */
const keepInk = (items: readonly { el: HTMLElement; ink: string }[]) => {
  const changed = items.filter(({ el, ink }) => resolveColor(getComputedStyle(el).color).rgb !== ink);
  for (const { el, ink } of changed) setStyle(el, "color", ink);
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
  position: fixed; z-index: 2147483646; pointer-events: none; box-sizing: border-box;
  width: 240px; padding: 12px 14px;
  border-radius: 12px; background: rgb(22 22 26 / 0.97); color: #f3f1ec;
  font: 13px/1.5 "Bricolage Grotesque", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.06) inset, 0 14px 36px rgb(0 0 0 / 0.3);
  opacity: 0; transform: translateY(4px); transition: opacity 120ms ease-out, transform 120ms ease-out;
}
.card.open { opacity: 1; transform: none; }
.card.open.editable { pointer-events: auto; }
.section + .section { margin-top: 14px; padding-top: 14px; border-top: 1px solid rgb(255 255 255 / 0.1); }
.title { font-weight: 650; font-size: 14px; }
.status { margin: 2px 0 10px; font-size: 12px; letter-spacing: 0.02em; color: #c9c3b8; }
.ramp { height: 8px; border-radius: 4px; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.14); }
.ends { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; font: 12px ui-monospace, "IBM Plex Mono", monospace; color: #e2ddd3; }
.slider { position: relative; height: 24px; touch-action: none; }
.span { position: absolute; left: 6px; right: 6px; top: 0; bottom: 0; pointer-events: none; }
.track { position: absolute; left: 0; right: 0; top: 5px; height: 8px; border-radius: 4px; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.14); }
/* Where the column's own values lie on the track. */
.data { position: absolute; top: 18px; height: 2px; min-width: 2px; border-radius: 1px; background: rgb(255 255 255 / 0.55); }
input[type="range"] {
  all: unset; -webkit-appearance: none; appearance: none; position: absolute; left: 0; top: 0;
  width: 100%; height: 18px; margin: 0; background: none; pointer-events: none;
}
input[type="range"]::-webkit-slider-runnable-track { -webkit-appearance: none; height: 18px; background: none; }
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; pointer-events: auto; cursor: ew-resize;
  width: 12px; height: 18px; border-radius: 4px; background: #f3f1ec;
  box-shadow: 0 0 0 1.5px rgb(22 22 26), 0 1px 4px rgb(0 0 0 / 0.5);
}
input[type="range"]::-webkit-slider-thumb:hover { background: #fff; }
input[type="range"]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 1.5px rgb(22 22 26), 0 0 0 3.5px #8f82f0; }
.presets { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
button {
  all: unset; cursor: pointer; padding: 3px 8px; border-radius: 6px; font-size: 12px; line-height: 1.5;
  color: #d9d4ca; background: rgb(255 255 255 / 0.08);
}
button:hover { background: rgb(255 255 255 / 0.16); color: #fff; }
button:focus-visible { outline: 2px solid #8f82f0; outline-offset: 1px; }
.fact { margin-top: 8px; font-size: 12px; color: #a7a196; }
.fact + .fact { margin-top: 2px; }
`;

/** One column's legend in a card, and the handler that sets its range when the card can edit it. */
interface CardSection {
  readonly legend: Legend;
  readonly col: number;
  readonly edit: {
    readonly preview: (range: ScaleRange) => void;
    readonly set: (range: ScaleRange | null) => void;
  } | null;
}

/** How a card reports a new range for the column at `col`. */
export interface RangeHandlers {
  /** Shows a range while the user drags a thumb. Nothing is saved. */
  readonly preview: (col: number, range: ScaleRange) => void;
  /** Saves the range, or clears it with null. The caller paints again. */
  readonly set: (col: number, range: ScaleRange | null) => void;
}

let card: { host: HTMLElement; root: ShadowRoot; el: HTMLDivElement } | null = null;
let scrollWatched = false;
/** The header whose card is open. */
let anchored: Element | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** The mouse has this long to cross from a header to its card before the card closes. */
const HIDE_DELAY_MS = 180;

/**
 * The card to open again after the repaint that a new range causes. Painting
 * replaces every card, and the user is still in this one, often about to type
 * the other end.
 */
let reopen: { table: HTMLTableElement; col: number; end: string | null; until: number } | null = null;
const REOPEN_MS = 5000;

const editing = (): boolean => card !== null && card.root.activeElement !== null;

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
  const el = root.querySelector<HTMLDivElement>(".card")!;
  card = { host, root, el };
  el.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  el.addEventListener("pointerleave", (ev) => ev.pointerType === "mouse" && hideCardSoon());
  // The mouse may have left while an end was being typed, so the card closes when focus leaves it too.
  el.addEventListener("focusout", () => setTimeout(() => !editing() && !el.matches(":hover") && hideCard()));
  // Page shortcuts must not fire while the user types a number.
  for (const type of ["keydown", "keyup", "keypress"]) el.addEventListener(type, (ev) => ev.stopPropagation());
  if (!scrollWatched) {
    // A scroll moves the header away from the card, unless the scroll came from focusing an end.
    addEventListener("scroll", () => !editing() && hideCard(), { passive: true, capture: true });
    // With touch nothing "leaves" the header, so a press anywhere else closes the card.
    addEventListener(
      "pointerdown",
      (ev) => {
        if (anchored === null) return;
        const path = ev.composedPath();
        if (!path.includes(card!.host) && !path.includes(anchored)) hideCard();
      },
      { capture: true },
    );
  }
  scrollWatched = true;
  return card;
};

/** A thumb's range input counts positions along the track in this many steps. */
const POSITIONS = 1000;

/** The track's colors: the scale between the two thumbs, and its end colors beyond them. */
const trackGradient = (stops: readonly string[], lo: number, hi: number): string => {
  const pct = (p: number) => `${(p * 100).toFixed(2)}%`;
  const inner = stops.map((c, i) => `${c} ${pct(lo + ((hi - lo) * i) / (stops.length - 1))}`);
  return `linear-gradient(90deg, ${stops[0]} 0%, ${inner.join(", ")}, ${stops.at(-1)} 100%)`;
};

/**
 * Turns a number column's ramp into a slider with a thumb at each end of the
 * scale. The track is wider than the data, and a mark under it shows where
 * the data lies, so dragging a thumb away from the mark calms the colors and
 * dragging it past the mark gives every value beyond it the end color.
 * Dragging previews the range on the page; letting go sets it. The legend's
 * presets go under the ends.
 */
const rangeSlider = (
  ramp: HTMLElement,
  ends: HTMLElement,
  section: CardSection,
  table: HTMLTableElement,
  edit: NonNullable<CardSection["edit"]>,
) => {
  const { legend } = section;
  const range = legend.range!;
  const { track, fit, unit } = range;
  // A thumb near an end of the data, or near zero, lands on it.
  const marks = [fit[0], fit[1], 0];
  let current: [number, number] = [range.lo, range.hi];

  const span = document.createElement("div");
  span.className = "span";
  const bar = document.createElement("div");
  bar.className = "track";
  const data = document.createElement("div");
  data.className = "data";
  data.style.left = `${trackPosition(track, fit[0]) * 100}%`;
  data.style.width = `${(trackPosition(track, fit[1]) - trackPosition(track, fit[0])) * 100}%`;
  span.append(bar, data);
  const thumb = (end: "lo" | "hi", value: number): HTMLInputElement => {
    const el = document.createElement("input");
    el.type = "range";
    el.min = "0";
    el.max = String(POSITIONS);
    el.step = "1";
    el.dataset["end"] = end;
    el.value = String(Math.round(trackPosition(track, value) * POSITIONS));
    el.setAttribute("aria-label", `${end === "lo" ? "Low" : "High"} end of the ${legend.title} scale`);
    return el;
  };
  const lo = thumb("lo", range.lo);
  const hi = thumb("hi", range.hi);
  ramp.className = "slider";
  ramp.style.background = "";
  ramp.replaceChildren(span, lo, hi);
  const [loLabel, hiLabel] = [...ends.children] as HTMLElement[];

  const draw = () => {
    bar.style.background = trackGradient(
      legend.stops,
      trackPosition(track, current[0]),
      trackPosition(track, current[1]),
    );
    loLabel!.textContent = withUnit(current[0], unit);
    hiLabel!.textContent = withUnit(current[1], unit);
    lo.setAttribute("aria-valuetext", loLabel!.textContent);
    hi.setAttribute("aria-valuetext", hiLabel!.textContent);
  };
  draw();

  // The thumbs overlap when the range is narrow. The one nearer the pointer goes on top.
  ramp.addEventListener("pointermove", (ev) => {
    if (ev.buttons !== 0) return;
    const box = ramp.getBoundingClientRect();
    const p = (ev.clientX - box.left) / box.width;
    const nearLo =
      Math.abs(p - trackPosition(track, current[0])) < Math.abs(p - trackPosition(track, current[1])) ||
      p < trackPosition(track, current[0]);
    lo.style.zIndex = nearLo ? "2" : "1";
    hi.style.zIndex = nearLo ? "1" : "2";
  });

  let frame = 0;
  const preview = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => edit.preview(current));
  };
  const send = (next: ScaleRange | null) => {
    cancelAnimationFrame(frame);
    // Read the focus after the browser has settled it, so the same thumb gets it back after the repaint.
    setTimeout(() => {
      const end = (card?.root.activeElement as HTMLElement | null)?.dataset["end"] ?? null;
      reopen = { table, col: section.col, end, until: Date.now() + REOPEN_MS };
      edit.set(next);
    });
  };
  const slide = (el: HTMLInputElement, at: 0 | 1) => {
    const value = trackValue(track, el.valueAsNumber / POSITIONS, marks);
    const next: [number, number] = at === 0 ? [value, current[1]] : [current[0], value];
    // A thumb stops short of the other one.
    if (!isUsableRange(next)) {
      el.value = String(Math.round(trackPosition(track, current[at]) * POSITIONS));
      return;
    }
    current = next;
    draw();
    preview();
  };
  const commit = () => {
    if (current[0] === range.lo && current[1] === range.hi) return;
    // Both thumbs back on the ends of the data is the fitted range, so nothing custom is kept.
    send(current[0] === fit[0] && current[1] === fit[1] ? null : current);
  };
  lo.addEventListener("input", () => slide(lo, 0));
  hi.addEventListener("input", () => slide(hi, 1));
  lo.addEventListener("change", commit);
  hi.addEventListener("change", commit);

  if (range.presets.length === 0) return;
  const presets = document.createElement("div");
  presets.className = "presets";
  for (const preset of range.presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.label;
    button.addEventListener("click", () => send(preset.range));
    presets.append(button);
  }
  ends.after(presets);
};

const showCard = (anchor: Element, sections: readonly CardSection[], table: HTMLTableElement) => {
  const { el } = ensureCard();
  clearTimeout(hideTimer);
  anchored = anchor;
  const box = select(el);
  box.selectAll("*").remove();
  const section = box.selectAll(".section").data(sections).join("div").attr("class", "section");
  section
    .append("div")
    .attr("class", "title")
    .text((d) => d.legend.title);
  section
    .append("div")
    .attr("class", "status")
    .text((d) => d.legend.status);
  section
    .append("div")
    .attr("class", "ramp")
    .style("background", (d) => gradient(d.legend.stops));
  const ends = section.append("div").attr("class", "ends");
  ends.append("span").text((d) => d.legend.lo);
  ends.append("span").text((d) => d.legend.hi);
  section.each(function (d) {
    if (d.edit === null || d.legend.range === null) return;
    const el = this as HTMLElement;
    rangeSlider(el.querySelector(".ramp")!, el.querySelector(".ends")!, d, table, d.edit);
  });
  section
    .selectAll(".fact")
    .data((d) => d.legend.facts)
    .join("div")
    .attr("class", "fact")
    .text((d) => d);
  const editable = sections.some((d) => d.edit !== null && d.legend.range !== null);
  el.classList.toggle("editable", editable);
  // A card with inputs is more than a tooltip.
  el.setAttribute("role", editable ? "group" : "tooltip");

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
  clearTimeout(hideTimer);
  anchored = null;
  if (card === null) return;
  // A hidden card must not keep the focus, or typing would go to an input nobody can see.
  (card.root.activeElement as HTMLElement | null)?.blur();
  card.el.classList.remove("open");
}

/** Closes the card unless the mouse reaches it first, or the user is typing in it. */
function hideCardSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => !editing() && hideCard(), HIDE_DELAY_MS);
}

const LONG_PRESS_MS = 450;
const detach = new WeakMap<HTMLElement, () => void>();

/**
 * Opens the card while the mouse is over the header. With touch or a pen, a
 * press and hold opens it, so a tap still sorts the table. A card that can
 * edit a range stays open while the mouse crosses to it.
 */
const attachCard = (header: HTMLElement, sections: readonly CardSection[], table: HTMLTableElement) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const editable = sections.some((d) => d.edit !== null && d.legend.range !== null);
  const open = () => showCard(header, sections, table);
  const enter = (ev: PointerEvent) => ev.pointerType === "mouse" && open();
  const leave = (ev: PointerEvent) => ev.pointerType === "mouse" && (editable ? hideCardSoon() : hideCard());
  const down = (ev: PointerEvent) => {
    if (ev.pointerType !== "mouse") timer = setTimeout(open, LONG_PRESS_MS);
  };
  const up = () => clearTimeout(timer);
  header.addEventListener("pointerenter", enter);
  header.addEventListener("pointerleave", leave);
  header.addEventListener("pointerdown", down);
  header.addEventListener("pointerup", up);
  header.addEventListener("pointercancel", up);
  header.dataset["pdLegend"] = sections.map((d) => d.legend.title).join("|");
  detach.set(header, () => {
    clearTimeout(timer);
    header.removeEventListener("pointerenter", enter);
    header.removeEventListener("pointerleave", leave);
    header.removeEventListener("pointerdown", down);
    header.removeEventListener("pointerup", up);
    header.removeEventListener("pointercancel", up);
    delete header.dataset["pdLegend"];
  });
  // This paint followed a new range from this column's card: open it again, with the focus where it was.
  if (reopen !== null && reopen.table === table && sections.some((d) => d.col === reopen!.col)) {
    const { col, end, until } = reopen;
    reopen = null;
    if (Date.now() > until) return;
    open();
    if (end === null) return;
    const at = sections.findIndex((d) => d.col === col);
    const input = card?.el
      .querySelectorAll(".section")
      [at]?.querySelector<HTMLInputElement>(`input[data-end="${end}"]`);
    input?.focus();
    input?.select();
  }
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Shades the encoded columns of one table and attaches a legend card to each
 * shaded header. With `onRange`, the card of a number column has a slider
 * that previews and sets the column's range.
 */
export const paintTable = (
  table: ExtractedTable,
  judgment: TableJudgment,
  palette: Palette,
  groupSizes: ReadonlyMap<string, number>,
  onRange?: RangeHandlers,
) => {
  const excluded = new Set(judgment.aggregateRows);
  const aggregates = judgment.aggregateRows.map((r) => table.snapshot.rows[r]?.[0] ?? "").filter((x) => x !== "");
  // A spanning header can be over several shaded columns. It gets one card with a section for each.
  const byHeader = new Map<HTMLTableCellElement, CardSection[]>();
  const rows = new Map<Element, string>();
  for (const e of judgment.encodings) {
    paintColumn(table, e, palette, excluded, rows);
    const header = table.headerCells[e.col];
    if (header == null) continue;
    const legend = describeColumn(e, palette, isDark(effectiveBackground(header)), {
      sharedWith: e.group === null ? 1 : (groupSizes.get(e.group) ?? 1),
      aggregates,
    });
    const edit =
      onRange === undefined
        ? null
        : {
            preview: (range: ScaleRange) => onRange.preview(e.col, range),
            set: (range: ScaleRange | null) => onRange.set(e.col, range),
          };
    byHeader.set(header, [...(byHeader.get(header) ?? []), { legend, col: e.col, edit }]);
  }
  const inks = [...byHeader.keys()].map((el) => ({ el, ink: resolveColor(getComputedStyle(el).color).rgb }));
  for (const [header, sections] of byHeader) {
    underline(header, sections[0]!.legend.stops, table.axis);
    attachCard(header, sections, table.element);
  }
  keepInk(inks);
  table.element.dataset["pdTable"] = judgment.id;
  table.element.dataset["pdOrientation"] = judgment.orientation;
  table.element.dataset["pdEncoded"] = judgment.encodings
    .map((e) =>
      e.kind === "quantitative" ? `${e.col}:${e.polarity}:${e.transform}` : `${e.col}:ordinal:${e.order.join(">")}`,
    )
    .join("|");
};

/**
 * Paints one column again with a new encoding, such as a range the user is
 * dragging. The header mark and the cards stay as they are, because a
 * column's colors do not depend on its range.
 */
export const repaintColumn = (
  table: ExtractedTable,
  encoding: ColumnEncoding,
  palette: Palette,
  aggregateRows: readonly number[],
) => {
  // Put the page's own styles back first. The painter reads each cell's text color to choose its fill.
  for (const cell of new Set(table.cells.map((row) => row[encoding.col]!))) restoreStyles(cell);
  paintColumn(table, encoding, palette, new Set(aggregateRows), new Map());
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
