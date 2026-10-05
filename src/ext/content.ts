/**
 * Content script. Extracts tables, asks the service worker for judgments, and
 * shades them. Re-runs when tables appear, change, or expand, and when a
 * single-page app navigates.
 *
 * Only tables that have come within about a screen of the viewport are
 * extracted and sent, at most MAX_TABLES per page. Each request carries every
 * table seen so far: earlier tables hit the answer cache, and cross-table scale
 * sharing still sees the whole set.
 *
 * Never reads extension settings (they hold API keys); the worker answers
 * whether this page is on.
 *
 * Status for tests and debugging is on <html data-pd-status>:
 * "working" → "done" | "error:<reason>" | "off" | "none" | "idle" (tables
 * exist but none are near the viewport yet).
 */
import type { Orientation } from "../core/orient.ts";
import { attachControls, detachControls } from "../dom/controls.ts";
import { extractPage, transposeExtracted, type ExtractedTable } from "../dom/extract.ts";
import { paintTable, unpaint } from "../dom/paint.ts";
import type { JudgeReply, PageConfig, PageState, ToContent, ToWorker } from "./messages.ts";
import { loadTableChoices, saveTableChoices, type TableChoice } from "./settings.ts";

/** Generous: Baseball-Reference player pages, the busiest seen so far, have under 30. */
const MAX_TABLES = 200;
/** How far outside the viewport a table counts as "near". */
const NEAR = "100% 0px";
/** A judgment that takes longer than this (worker restarted, network hung) is abandoned. */
const REPLY_TIMEOUT_MS = 60_000;

const root = document.documentElement;
const setStatus = (s: string) => {
  root.dataset["pdStatus"] = s;
};

let enabled = false;
let generation = 0;
/** Generation of the reply currently on screen; older replies are dropped. */
let paintedGeneration = 0;
/** Snapshot JSON of what is currently shaded, to skip no-op mutation rounds. */
let painted = "";
/** One painted cell per table: if the page re-renders rows, it disappears. */
let sampleCell = new WeakMap<HTMLTableElement, HTMLElement>();

let seen = new WeakSet<HTMLTableElement>();
let seenCount = 0;
let capLogged = false;

const send = <T>(msg: ToWorker): Promise<T> =>
  Promise.race([
    chrome.runtime.sendMessage(msg) as Promise<T>,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for the worker")), REPLY_TIMEOUT_MS)),
  ]);

/** Same table, same choice, wherever it sits on the page: keyed by its content, not its position. */
const fingerprint = (t: ExtractedTable): string => {
  const text = `${t.snapshot.headers.join("␟")}␞${(t.snapshot.rows[0] ?? []).join("␟")}`;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const isIntact = (t: ExtractedTable): boolean => {
  if (t.element.dataset["pdTable"] === undefined) return false;
  const sample = sampleCell.get(t.element);
  return sample === undefined || (sample.isConnected && sample.dataset["pdT"] !== undefined);
};

const run = async (force = false) => {
  if (!enabled) return;
  const gen = ++generation;
  mutations.disconnect();
  try {
    await judgeAndPaint(gen, force);
  } catch (e) {
    if (gen === generation) setStatus("error:internal");
    console.info("[practical-data]", e);
  } finally {
    if (enabled) observeMutations();
  }
};

const judgeAndPaint = async (gen: number, force: boolean) => {
  // Only tables near the viewport are extracted; the rest are just watched.
  const extracted = extractPage(document, (el) => seen.has(el));
  for (const el of extracted.elements) if (!seen.has(el)) nearby.observe(el);
  if (extracted.elements.length === 0) {
    setStatus("none");
    return;
  }
  const nearbyTables = extracted.tables;
  if (nearbyTables.length === 0) {
    setStatus("idle");
    return;
  }
  // Tables the reader hid are not sent; the rest carry their chosen orientation.
  const tables = nearbyTables.filter((t) => choices[fingerprint(t)]?.hidden !== true);
  const orientations: Record<string, Orientation> = {};
  for (const t of tables) {
    const o = choices[fingerprint(t)]?.orientation;
    if (o !== undefined) orientations[t.snapshot.id] = o;
  }
  const page = { ...extracted.page, tables: tables.map((t) => t.snapshot) };
  const key = JSON.stringify([page.tables, orientations]);
  // Same text is not enough: frameworks re-render tables (or just their rows)
  // with identical content, dropping our paint.
  if (!force && key === painted && tables.every(isIntact)) return;

  setStatus("working");
  const reply = await send<JudgeReply>({ type: "judge", page, orientations });
  // A newer reply may already be on screen; while scrolling, older ones still
  // paint so tables don't wait for the user to stop.
  if (gen < paintedGeneration || !enabled) return;
  if (!reply.ok) {
    if (gen === generation) setStatus(`error:${reply.reason}`);
    console.info("[practical-data]", reply.message);
    return;
  }
  unpaint();
  sampleCell = new WeakMap();
  const byId = new Map<string, ExtractedTable>(tables.map((t) => [t.snapshot.id, t]));
  const groupSizes = new Map<string, number>();
  for (const t of reply.judgment.tables) {
    for (const e of t.encodings) if (e.group !== null) groupSizes.set(e.group, (groupSizes.get(e.group) ?? 0) + 1);
  }
  for (const t of reply.judgment.tables) {
    const table = byId.get(t.id);
    if (!table?.element.isConnected) continue;
    paintTable(t.orientation === "rows" ? transposeExtracted(table) : table, t, reply.palette, groupSizes);
    const sample = table.element.querySelector<HTMLElement>("[data-pd-t]:not([data-pd-t=''])");
    if (sample !== null) sampleCell.set(table.element, sample);
    control(table, { orientation: t.orientation, hidden: false });
  }
  // Tables the judge skipped (too small) count as handled, so mutations don't re-send them forever.
  for (const t of tables) if (t.element.dataset["pdTable"] === undefined) t.element.dataset["pdTable"] = "";
  for (const table of nearbyTables) {
    const c = choices[fingerprint(table)];
    if (c?.hidden === true) control(table, { orientation: c.orientation ?? "columns", hidden: true });
  }
  if (reply.judgment.failed.length > 0) console.info("[practical-data] tables not judged:", reply.judgment.failed);
  pruneDetached();
  painted = key;
  paintedGeneration = gen;
  if (gen === generation) setStatus("done");
};

// ── Per-table controls ──────────────────────────────────────────────────────

/** The reader's per-table choices for this page, kept for the browser session. */
let choices: Record<string, TableChoice> = {};
const keyOf = new WeakMap<HTMLTableElement, string>();
const controlled = new Set<HTMLTableElement>();

const choose = (table: HTMLTableElement, change: TableChoice) => {
  const key = keyOf.get(table);
  if (key === undefined) return;
  choices = { ...choices, [key]: { ...choices[key], ...change } };
  void saveTableChoices(location.href, choices);
  void run(true);
};

const handlers = {
  orient: (table: HTMLTableElement, orientation: Orientation) => choose(table, { orientation }),
  hide: (table: HTMLTableElement, hidden: boolean) => choose(table, { hidden }),
};

/** Rows vs columns only means something with several value columns and a modest number of rows. */
const MAX_ROWS_FOR_ROWS = 40;

const control = (table: ExtractedTable, state: { orientation: Orientation; hidden: boolean }) => {
  keyOf.set(table.element, fingerprint(table));
  controlled.add(table.element);
  const { headers, rows } = table.snapshot;
  const canOrient = headers.length >= 3 && rows.length >= 2 && rows.length <= MAX_ROWS_FOR_ROWS;
  attachControls(table.element, { ...state, canOrient }, handlers);
};

const pruneDetached = () => {
  for (const t of controlled) {
    if (!t.isConnected) {
      detachControls(t);
      controlled.delete(t);
      resized.unobserve(t);
    }
  }
};

const releaseControls = () => {
  for (const t of controlled) detachControls(t);
  controlled.clear();
};

// ── Change detection ────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | undefined;
const schedule = (delay: number) => {
  clearTimeout(timer);
  timer = setTimeout(() => void run(), delay);
};

const nearby = new IntersectionObserver(
  (entries) => {
    let added = false;
    for (const entry of entries) {
      const table = entry.target as HTMLTableElement;
      if (!entry.isIntersecting || seen.has(table)) continue;
      nearby.unobserve(table);
      if (seenCount >= MAX_TABLES) {
        if (!capLogged) console.info(`[practical-data] judged the first ${MAX_TABLES} tables on this page; skipping the rest.`);
        capLogged = true;
        continue;
      }
      seen.add(table);
      seenCount++;
      resized.observe(table);
      added = true;
    }
    // Short delay batches the tables a single scroll reveals.
    if (added) schedule(150);
  },
  { rootMargin: NEAR },
);

/**
 * Collapsed tables (Wikipedia's [show]) and tables in inactive tabs have a
 * visible header, so they get judged while their rows are hidden. Expanding
 * them changes only classes and styles, which the mutation observer ignores;
 * their size is the signal. Re-extraction is free unless the visible text
 * actually changed.
 */
const lastHeight = new WeakMap<Element, number>();
const resized = new ResizeObserver((entries) => {
  let changed = false;
  for (const entry of entries) {
    const height = entry.contentRect.height;
    const before = lastHeight.get(entry.target);
    lastHeight.set(entry.target, height);
    if (before !== undefined && Math.abs(height - before) > 24) changed = true;
  }
  if (changed) schedule(250);
});

const insideTable = (n: Node | null): boolean =>
  n !== null && (n instanceof Element ? n : n.parentElement)?.closest("table") != null;

/**
 * A table was added or removed, or text inside one changed: sorters and live
 * tables rewrite cells in place, which adds Text nodes, not elements.
 */
const touchesTable = (m: MutationRecord): boolean => {
  if (m.type === "characterData") return insideTable(m.target);
  if (insideTable(m.target)) return true;
  return [...m.addedNodes, ...m.removedNodes].some(
    (n) => n instanceof Element && (n.tagName === "TABLE" || n.querySelector("table") !== null),
  );
};

const mutations = new MutationObserver((records) => {
  if (records.some(touchesTable)) schedule(600);
});
const observeMutations = () => mutations.observe(document.body, { childList: true, subtree: true, characterData: true });

// ── Messages ────────────────────────────────────────────────────────────────

const turnOff = () => {
  generation++;
  paintedGeneration = generation;
  mutations.disconnect();
  unpaint();
  releaseControls();
  painted = "";
  setStatus("off");
};

chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResponse) => {
  if (msg.type === "state") {
    const tables = [...document.querySelectorAll<HTMLElement>("table[data-pd-table]")];
    sendResponse({
      url: location.href,
      enabled,
      status: root.dataset["pdStatus"] ?? "none",
      tables: tables.filter((t) => (t.dataset["pdEncoded"] ?? "") !== "").length,
      columns: tables.reduce((n, t) => n + (t.dataset["pdEncoded"] ?? "").split("|").filter(Boolean).length, 0),
    } satisfies PageState);
    return false;
  }
  if (msg.type === "toggle") {
    enabled = msg.enabled && !optedOut();
    if (enabled) void run(true);
    else turnOff();
  } else if (msg.type === "repaint") {
    void run(true);
  }
  return false;
});

// ── Start, and restart on single-page-app navigation ────────────────────────

/** Pages can opt out: <meta name="practical-data" content="off"> (the demo site shades itself). */
const optedOut = () => document.querySelector('meta[name="practical-data"][content="off" i]') !== null;

const start = async () => {
  const [config, saved] = await Promise.all([
    send<PageConfig>({ type: "pageConfig", url: location.href }).catch((): PageConfig => ({ enabled: false })),
    loadTableChoices(location.href),
  ]);
  choices = saved;
  enabled = config.enabled && !optedOut();
  if (!enabled) {
    setStatus("off");
    return;
  }
  void run();
};

let lastHref = location.href;
const onNavigate = () => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  // A new page in the same document: forget the old page's tables and choices.
  turnOff();
  seen = new WeakSet();
  seenCount = 0;
  capLogged = false;
  nearby.disconnect();
  void start();
};
(globalThis as { navigation?: EventTarget }).navigation?.addEventListener("navigatesuccess", onNavigate);
addEventListener("popstate", onNavigate);
// Fallback for routers the Navigation API doesn't report.
setInterval(onNavigate, 1000);

void start();
