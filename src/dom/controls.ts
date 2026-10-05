/**
 * Per-table controls: a small bar that appears at a judged table's top-right
 * corner while the pointer is over it. It switches the shading between
 * columns and rows, or hides it for that table. Lives in a shadow root so
 * page CSS can't reach it, and is positioned over the page without touching
 * the table's layout.
 */
import type { Orientation } from "../core/orient.ts";

export interface TableControlState {
  readonly orientation: Orientation;
  readonly hidden: boolean;
  /** Whether rows/columns makes sense here (several numeric columns and rows). */
  readonly canOrient: boolean;
}

export interface TableControlHandlers {
  readonly orient: (table: HTMLTableElement, orientation: Orientation) => void;
  readonly hide: (table: HTMLTableElement, hidden: boolean) => void;
}

const CSS = `
:host { all: initial; }
.bar {
  position: fixed; z-index: 2147483645; display: none; align-items: center; gap: 6px;
  padding: 4px; border-radius: 9px; background: rgb(22 22 26 / 0.96); color: #f3f1ec;
  font: 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.06) inset, 0 8px 22px rgb(0 0 0 / 0.28);
}
.bar.open { display: flex; }
.label { padding: 0 4px 0 6px; color: #a7a196; }
.seg { display: inline-flex; padding: 2px; border-radius: 7px; background: rgb(255 255 255 / 0.08); }
button {
  all: unset; cursor: pointer; padding: 5px 9px; border-radius: 6px; color: #d9d4ca;
}
button:hover { background: rgb(255 255 255 / 0.1); color: #fff; }
button[aria-pressed="true"] { background: #f3f1ec; color: #16151a; }
button:focus-visible { outline: 2px solid #8f82f0; outline-offset: 1px; }
.sep { width: 1px; height: 16px; background: rgb(255 255 255 / 0.14); }
`;

let bar: { host: HTMLElement; el: HTMLDivElement } | null = null;
let current: { table: HTMLTableElement; state: TableControlState; handlers: TableControlHandlers } | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let scrollWatched = false;

const ensureBar = () => {
  if (bar !== null && bar.host.isConnected) return bar;
  const host = document.createElement("span");
  host.setAttribute("data-pd-controls", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style><div class="bar" role="toolbar" aria-label="Table shading"></div>`;
  document.documentElement.append(host);
  const el = root.querySelector<HTMLDivElement>(".bar")!;
  el.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  el.addEventListener("pointerleave", scheduleHide);
  bar = { host, el };
  if (!scrollWatched) addEventListener("scroll", () => bar?.el.classList.remove("open"), { passive: true, capture: true });
  scrollWatched = true;
  return bar;
};

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bar?.el.classList.remove("open"), 350);
}

const render = () => {
  if (current === null) return;
  const { el } = ensureBar();
  const { table, state, handlers } = current;
  el.replaceChildren();
  const button = (label: string, pressed: boolean | null, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (pressed !== null) b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return b;
  };
  if (state.canOrient && !state.hidden) {
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Compare";
    const seg = document.createElement("span");
    seg.className = "seg";
    seg.append(
      button("Columns", state.orientation === "columns", () => handlers.orient(table, "columns")),
      button("Rows", state.orientation === "rows", () => handlers.orient(table, "rows")),
    );
    const sep = document.createElement("span");
    sep.className = "sep";
    el.append(label, seg, sep);
  }
  el.append(button(state.hidden ? "Show shading" : "Hide shading", null, () => handlers.hide(table, !state.hidden)));
};

const place = (table: HTMLTableElement) => {
  const { el } = ensureBar();
  el.classList.add("open");
  const r = table.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const top = r.top - h - 6 >= 4 ? r.top - h - 6 : Math.max(4, r.top + 6);
  el.style.top = `${top}px`;
  el.style.left = `${Math.min(Math.max(4, r.right - w), innerWidth - w - 4)}px`;
};

const attached = new WeakMap<HTMLTableElement, { state: TableControlState; detach: () => void }>();

/** Attaches (or updates) controls for a judged table. Idempotent. */
export const attachControls = (table: HTMLTableElement, state: TableControlState, handlers: TableControlHandlers) => {
  const existing = attached.get(table);
  if (existing !== undefined) {
    existing.state = state;
    if (current?.table === table) {
      current = { table, state, handlers };
      render();
    }
    return;
  }
  const entry = { state, detach: () => {} };
  const enter = (ev: PointerEvent) => {
    if (ev.pointerType !== "mouse") return;
    clearTimeout(hideTimer);
    current = { table, state: entry.state, handlers };
    render();
    place(table);
  };
  table.addEventListener("pointerenter", enter);
  table.addEventListener("pointerleave", scheduleHide);
  entry.detach = () => {
    table.removeEventListener("pointerenter", enter);
    table.removeEventListener("pointerleave", scheduleHide);
  };
  attached.set(table, entry);
};

export const detachControls = (table: HTMLTableElement) => {
  attached.get(table)?.detach();
  attached.delete(table);
  if (current?.table === table) bar?.el.classList.remove("open");
};
