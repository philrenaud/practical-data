/**
 * The content script. It extracts tables, asks the service worker for
 * judgments, and shades the tables. It runs again when tables appear, change,
 * or expand, and when a single-page app navigates.
 *
 * The script extracts and sends only tables that have come within about one
 * screen of the viewport, and at most MAX_TABLES per page. Each request
 * carries every table seen so far. Earlier tables hit the answer cache, and
 * the scales shared across tables still see the whole set.
 *
 * The script never reads the extension settings, because they hold API keys.
 * The worker says whether the page is on.
 *
 * The status for tests and debugging is in `<html data-pd-status>`. It starts
 * as "working" and ends as "done", "error:<reason>", "off", "none", or "idle".
 * "idle" means the page has tables but none is near the viewport yet.
 */
import type { Orientation } from "../core/orient.ts";
import { attachControls, detachControls } from "../dom/controls.ts";
import { extractPage, transposeExtracted, type ExtractedTable } from "../dom/extract.ts";
import { paintTable, unpaint } from "../dom/paint.ts";
import type { JudgeReply, PageConfig, PageState, ToContent, ToWorker } from "./messages.ts";
import { afterSend, PACE_START, waitFor } from "./pace.ts";
import type { TableChoice } from "./settings.ts";

/** The cap is high. Baseball-Reference player pages, the busiest seen so far, have fewer than 30 tables. */
const MAX_TABLES = 200;
/** How far outside the viewport a table counts as "near". */
const NEAR = "100% 0px";
/** The script abandons a judgment that takes longer than this, for example after a worker restart. */
const REPLY_TIMEOUT_MS = 60_000;

const root = document.documentElement;
const setStatus = (s: string) => {
  root.dataset["pdStatus"] = s;
};

let enabled = false;
let generation = 0;
/** The generation of the reply on screen. Replies older than this are dropped. */
let paintedGeneration = 0;
/** The snapshot JSON of what is shaded now. A mutation round with the same snapshot does nothing. */
let painted = "";
/** One painted cell per table. If the page re-renders the rows, this cell leaves the document. */
let sampleCell = new WeakMap<HTMLTableElement, HTMLElement>();

let seen = new WeakSet<HTMLTableElement>();
let seenCount = 0;
let capLogged = false;

const send = <T>(msg: ToWorker): Promise<T> =>
  Promise.race([
    chrome.runtime.sendMessage(msg) as Promise<T>,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timed out waiting for the worker")), REPLY_TIMEOUT_MS),
    ),
  ]);

/** Keys a table by its content, not its position, so a choice stays with the table when the page moves it. */
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

/**
 * Runs extraction and, if the tables changed, a judge request. `paced` marks a
 * run that a page change triggered. Those runs follow pace.ts.
 */
const run = async (force = false, paced = false) => {
  if (!enabled) return;
  const gen = ++generation;
  mutations.disconnect();
  try {
    await judgeAndPaint(gen, force, paced);
  } catch (e) {
    if (gen === generation) setStatus("error:internal");
    console.info("[practical-data]", e);
  } finally {
    if (enabled) observeMutations();
  }
};

const judgeAndPaint = async (gen: number, force: boolean, paced: boolean) => {
  // extractPage extracts only the tables in `seen`. `nearby` watches the rest until they come near the viewport.
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
  // Hidden tables are not sent. The others carry the orientation the user chose.
  const tables = nearbyTables.filter((t) => choices[fingerprint(t)]?.hidden !== true);
  const orientations: Record<string, Orientation> = {};
  for (const t of tables) {
    const o = choices[fingerprint(t)]?.orientation;
    if (o !== undefined) orientations[t.snapshot.id] = o;
  }
  const page = { ...extracted.page, tables: tables.map((t) => t.snapshot) };
  const key = JSON.stringify([page.tables, orientations]);
  // The same text is not enough. Frameworks re-render tables or rows with the
  // same content, and the new elements have no paint.
  if (!force && key === painted && tables.every(isIntact)) return;
  // Only new text costs model requests. A re-render with the same text hits the answer cache.
  if (paced && key !== painted) pace = afterSend(pace, Date.now());

  setStatus("working");
  const reply = await send<JudgeReply>({ type: "judge", page, orientations });
  // Drop a reply if a newer one is on screen. An older reply that arrives before
  // the newest still paints, so tables shade while the user scrolls.
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
  // Mark tables the judge skipped as handled, so that mutations don't send them again.
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

/** The user's per-table choices for this page, kept until the browser session ends. */
let choices: Record<string, TableChoice> = {};
const keyOf = new WeakMap<HTMLTableElement, string>();
const controlled = new Set<HTMLTableElement>();

const choose = (table: HTMLTableElement, change: TableChoice) => {
  const key = keyOf.get(table);
  if (key === undefined) return;
  choices = { ...choices, [key]: { ...choices[key], ...change } };
  void send({ type: "saveTableChoices", url: location.href, choices }).catch(() => undefined);
  void run(true);
};

const handlers = {
  orient: (table: HTMLTableElement, orientation: Orientation) => choose(table, { orientation }),
  hide: (table: HTMLTableElement, hidden: boolean) => choose(table, { hidden }),
};

/** Comparing by rows makes sense only for a table with several value columns and few rows. */
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

/** Pacing for runs that page changes trigger. It lasts for the life of the document. */
let pace = PACE_START;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Schedules a paced run after a page change. A pending run absorbs later
 * changes, so a page that changes faster than the wait still gets shaded.
 */
const scheduleChange = () => {
  if (changeTimer !== undefined) return;
  changeTimer = setTimeout(
    () => {
      changeTimer = undefined;
      void run(false, true);
    },
    waitFor(pace, Date.now()),
  );
};

const nearby = new IntersectionObserver(
  (entries) => {
    let added = false;
    for (const entry of entries) {
      const table = entry.target as HTMLTableElement;
      if (!entry.isIntersecting || seen.has(table)) continue;
      nearby.unobserve(table);
      if (seenCount >= MAX_TABLES) {
        if (!capLogged)
          console.info(`[practical-data] judged the first ${MAX_TABLES} tables on this page; skipping the rest.`);
        capLogged = true;
        continue;
      }
      seen.add(table);
      seenCount++;
      resized.observe(table);
      added = true;
    }
    // The short delay batches the tables that one scroll reveals.
    if (added) schedule(150);
  },
  { rootMargin: NEAR },
);

/**
 * Collapsed tables, such as Wikipedia's [show] tables, and tables in inactive
 * tabs have a visible header. The script judges them while their rows are
 * hidden. Expanding them changes only classes and styles, which the mutation
 * observer ignores, so a change in height triggers a new run. The new run
 * sends nothing unless the visible text changed.
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
  if (changed) scheduleChange();
});

const insideTable = (n: Node | null): boolean =>
  n !== null && (n instanceof Element ? n : n.parentElement)?.closest("table") != null;

/**
 * Returns true if a mutation added or removed a table, or changed text inside
 * one. Sorters and live tables rewrite cells in place, which adds Text nodes,
 * not elements.
 */
const touchesTable = (m: MutationRecord): boolean => {
  if (m.type === "characterData") return insideTable(m.target);
  if (insideTable(m.target)) return true;
  return [...m.addedNodes, ...m.removedNodes].some(
    (n) => n instanceof Element && (n.tagName === "TABLE" || n.querySelector("table") !== null),
  );
};

const mutations = new MutationObserver((records) => {
  if (records.some(touchesTable)) scheduleChange();
});
const observeMutations = () =>
  mutations.observe(document.body, { childList: true, subtree: true, characterData: true });

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

/** A page opts out with `<meta name="practical-data" content="off">`. The demo site uses it, because it shades itself. */
const optedOut = () => document.querySelector('meta[name="practical-data"][content="off" i]') !== null;

const start = async () => {
  const config = await send<PageConfig>({ type: "pageConfig", url: location.href }).catch((): PageConfig => ({
    enabled: false,
    choices: {},
  }));
  choices = config.choices;
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
  // The same document shows a new page, so forget the old page's tables and choices.
  turnOff();
  seen = new WeakSet();
  seenCount = 0;
  capLogged = false;
  nearby.disconnect();
  void start();
};
(globalThis as { navigation?: EventTarget }).navigation?.addEventListener("navigatesuccess", onNavigate);
addEventListener("popstate", onNavigate);
// Polling catches routers that the Navigation API doesn't report.
setInterval(onNavigate, 1000);

void start();
