/**
 * End-to-end: loads dist/ as an unpacked extension in Chromium, opens every
 * fixture page, and checks what a user would see.
 *
 *   node scripts/e2e.ts             # decision API calls go live (needs TYPESAFE_API_KEY)
 *   node scripts/e2e.ts --offline   # API calls are answered from fixtures/recordings
 *   node scripts/e2e.ts --live      # also visits the real URLs in fixtures/live/sources.json
 *   node scripts/e2e.ts --headed
 *
 * Checks per page: the pipeline finishes; every encoded column paints all its
 * non-missing cells; text on painted cells keeps ≥ 4.5:1 contrast; the
 * best-valued cell is greener than the worst for directional columns; legend
 * headers carry the gradient underline without changing any column width;
 * collapsed tables get judged once expanded; toggling off restores the
 * original markup exactly.
 * Screenshots land in artifacts/screens/.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright";
import { fixturePages, serve } from "./serve.ts";

const { values: args } = parseArgs({
  options: {
    offline: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    only: { type: "string" },
  },
});

const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
if (!args.offline && apiKey === "") throw new Error("TYPESAFE_API_KEY is required unless --offline");

const { url: base, server } = await serve("fixtures");
await mkdir("artifacts/screens", { recursive: true });

const context: BrowserContext = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: !args.headed,
  viewport: { width: 1360, height: 900 },
  args: ["--disable-extensions-except=dist", "--load-extension=dist"],
});

// Fixture pages must not reach the internet; the decision API may (or is replayed).
let replayMisses = 0;
await context.route("**/*", async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(base) || url.startsWith("chrome-extension://")) return route.continue();
  if (url.startsWith("https://api.typesafe.ai/")) {
    // Same key as AnswerCache: sha-256 of the exact JSON body.
    const key = createHash("sha256").update(req.postData() ?? "").digest("hex");
    if (!args.offline) {
      // Live: answer from the API and record it, so offline runs replay every request this run made.
      // A failed call should reach the extension as a network error, as it would in a browser.
      try {
        const response = await route.fetch();
        const body = await response.text();
        if (response.ok()) await writeFile(`fixtures/recordings/${key}.json`, body);
        return await route.fulfill({ response, body });
      } catch {
        return route.abort("failed").catch(() => undefined);
      }
    }
    const body = await readFile(`fixtures/recordings/${key}.json`, "utf8").catch(() => null);
    if (body === null) replayMisses++;
    return body === null
      ? route.fulfill({ status: 401, body: "no recording" })
      : route.fulfill({ status: 200, contentType: "application/json", body });
  }
  // Live sites load unmodified: blocking their images trips ad-block walls that lock scrolling.
  if (args.live) return route.continue();
  return route.abort();
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await worker.evaluate(
  (settings) => chrome.storage.local.set({ settings }),
  { provider: "jev", typesafeApiKey: args.offline ? "offline" : apiKey, palette: "classic", disabledHosts: [] },
);
// The worker opens options on first install; close it.
for (const p of context.pages()) if (p.url().includes("options.html")) await p.close();

interface PageReport {
  status: string;
  /** Tables judged before scrolling; lazy judging keeps this below `tables` on long pages. */
  initial: number;
  tables: number;
  columns: number;
  problems: string[];
}

/** Runs inside the page: verifies painted state. */
const inspect = () => {
  // Resolve any CSS color (oklch, color-mix…) to sRGB via a 1-pixel canvas, as the painter does.
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const toRgb = (css: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  const lum = (css: string) => {
    const m = toRgb(css).match(/[\d.]+/g)!.map(Number);
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(m[0]!) + 0.7152 * ch(m[1]!) + 0.0722 * ch(m[2]!);
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };
  const greenness = (c: string) => {
    const m = toRgb(c).match(/[\d.]+/g)!.map(Number);
    return m[1]! - m[0]!;
  };
  const problems: string[] = [];
  let columns = 0;
  const tables = [...document.querySelectorAll<HTMLTableElement>("table[data-pd-table]")];
  for (const table of tables) {
    const id = table.dataset["pdTable"];
    const encoded = (table.dataset["pdEncoded"] ?? "").split("|").filter(Boolean);
    for (const spec of encoded) {
      columns++;
      const [colText, kind] = spec.split(":") as [string, string];
      const col = Number(colText);
      const painted = [...table.querySelectorAll<HTMLTableCellElement>(`[data-pd-col="${col}"]`)];
      if (painted.length === 0) {
        problems.push(`${id} col ${col}: nothing painted`);
        continue;
      }
      for (const c of painted) {
        const cs = getComputedStyle(c);
        const ratio = contrast(cs.backgroundColor, cs.color);
        if (ratio < 4.5) problems.push(`${id} col ${col}: contrast ${ratio.toFixed(2)} on "${c.innerText.slice(0, 20)}"`);
      }
      if (kind === "higher_is_better" || kind === "lower_is_better") {
        const byT = painted.map((c) => [Number(c.dataset["pdT"]), c] as const).sort((a, b) => a[0] - b[0]);
        const worst = byT[0]![1];
        const best = byT.at(-1)![1];
        if (byT.at(-1)![0] - byT[0]![0] > 0.5 && greenness(getComputedStyle(best).backgroundColor) <= greenness(getComputedStyle(worst).backgroundColor)) {
          problems.push(`${id} col ${col}: best cell is not greener than worst`);
        }
      }
    }
    const legends = table.querySelectorAll<HTMLElement>("[data-pd-legend]");
    if (legends.length === 0 && encoded.length > 0) problems.push(`${id}: no header carries a legend`);
    for (const h of legends) {
      if (!getComputedStyle(h).backgroundImage.includes("gradient")) problems.push(`${id}: header "${h.innerText.slice(0, 20)}" has no underline`);
    }
  }
  return { tables: tables.length, columns, problems, encoded: tables.map((t) => `${t.dataset["pdTable"]}=${t.dataset["pdEncoded"]}`) };
};

/** Waits past the transient "idle" (tables found, none near the viewport yet) for a settled status. */
const waitForStatus = async (page: Page) => {
  await page
    .waitForFunction(
      () => !["working", "idle", undefined].includes(document.documentElement.dataset["pdStatus"]),
      undefined,
      { timeout: 8_000, polling: 100 },
    )
    .catch(() => undefined);
  return (await page.evaluate(() => document.documentElement.dataset["pdStatus"])) ?? "missing";
};

/** Serialized style + data attributes of every table subtree, to prove unpaint is exact. */
const markup = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("table")].map((t, i) => `<!--table ${i}-->${t.outerHTML}`).join("\n"));

/** Long pages where some tables start well below the fold. */
const LAZY_PAGES = ["bbref-aaron-judge", "wiki-mtg-sets"];

const run = async (name: string, url: string, live: boolean): Promise<PageReport> => {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Saved Baseball-Reference pages keep #content hidden until the site's JS runs; offline it never does.
  if (!live && name.startsWith("bbref-")) await page.addStyleTag({ content: "#content { display: block !important; }" });
  // Capture the untouched markup as early as possible for the restore check.
  const before = await markup(page);
  let status = await waitForStatus(page);
  let toggles: Awaited<ReturnType<ReturnType<Page["locator"]>["all"]>> = [];
  const initial = await page.evaluate(() => document.querySelectorAll("table[data-pd-table]").length);
  if (status === "done" || status === "idle") {
    // Scroll through the page like a user, so tables judged lazily near the viewport get painted.
    // Wait for load first: some sites (Baseball-Reference) reset scroll position on load.
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
    await page.mouse.move(400, 400);
    for (let i = 0; i < 200; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(120);
      const atEnd = await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2);
      if (atEnd) break;
    }
    await page.waitForTimeout(800);
    // Collapsed tables: expand them the way a user would; they must get judged afterwards.
    toggles = await page.locator("[data-e2e-expand]").all();
    for (const toggle of toggles) {
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
    }
    if (toggles.length > 0) await page.waitForTimeout(1500);
    status = await waitForStatus(page);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  const report: PageReport = { status, initial, tables: 0, columns: 0, problems: [] };
  // Pages that opt out (the demo site paints itself) must be left alone.
  const optedOut = await page.evaluate(() => document.querySelector('meta[name="practical-data"][content="off"]') !== null);
  if (optedOut) {
    if (status !== "off") report.problems.push(`opted-out page has status ${status}`);
    if ((await page.evaluate(() => document.querySelectorAll("[data-pd-t], [data-pd-table]").length)) > 0) {
      report.problems.push("opted-out page was painted");
    }
    await page.close();
    return report;
  }
  if (status === "done") {
    // Let background transitions (and any repaint the page's own JS triggered) settle.
    await page.waitForFunction(() => document.getAnimations().length === 0, undefined, { polling: 100, timeout: 10_000 }).catch(() => undefined);
    Object.assign(report, await page.evaluate(inspect));
    const unpaintedExpanded = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-e2e-expand]")].filter((t) => t.closest("table")?.querySelector("[data-pd-t]:not([data-pd-t=''])") == null).length,
    );
    if (unpaintedExpanded > 0) report.problems.push(`${unpaintedExpanded} expanded table(s) never got painted`);
    const first = page.locator("table[data-pd-table]").first();
    await first.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: `artifacts/screens/${name}.png` });
    // Toggle off through the same message the toolbar button sends.
    const thWidths = () => page.evaluate(() => [...document.querySelectorAll("th")].map((h) => h.getBoundingClientRect().width));
    const paintedWidths = await thWidths();
    // Without the "tabs" permission the worker can't match tabs by URL; only this page is open.
    await worker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id !== undefined) await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: false }).catch(() => undefined);
      }
    });
    await page.waitForFunction(() => document.documentElement.dataset["pdStatus"] === "off", undefined, { polling: 100 });
    // Painting must not change layout: every header keeps its width once the paint is gone.
    const plainWidths = await thWidths();
    const shifted = plainWidths.filter((w, i) => Math.abs(w - (paintedWidths[i] ?? w)) > 1).length;
    if (shifted > 0) report.problems.push(`painting changed the width of ${shifted} header cell(s)`);
    const leftovers = await page.evaluate(
      () => document.querySelectorAll("[data-pd-styled], [data-pd-t], [data-pd-table], [data-pd-legend]").length,
    );
    if (leftovers > 0) report.problems.push(`toggle off left ${leftovers} painted elements behind`);
    // Exact markup equality only holds where the page's own scripts don't rewrite tables.
    // Exact equality also can't hold where this test expanded a table itself.
    const after = await markup(page);
    if (!live && toggles.length === 0 && after !== before) {
      let i = 0;
      while (i < after.length && after[i] === before[i]) i++;
      const which = before.slice(0, i).match(/<!--table (\d+)-->/g)?.at(-1) ?? "?";
      report.problems.push(
        `toggle off did not restore the original table markup (${which}): ${JSON.stringify(before.slice(Math.max(0, i - 30), i + 50))} became ${JSON.stringify(after.slice(Math.max(0, i - 30), i + 50))}`,
      );
    }
    if (LAZY_PAGES.includes(name) && initial >= report.tables) {
      report.problems.push(`expected lazy judging: ${initial} tables judged before scrolling, ${report.tables} after`);
    }
  } else if (status !== "none") {
    report.problems.push(`status ${status}`);
  }
  await page.close();
  return report;
};

const targets: { name: string; url: string; live: boolean }[] = [];
for (const { slug, path } of await fixturePages()) targets.push({ name: slug, url: `${base}/${path}`, live: false });
if (args.live) {
  const sources = JSON.parse(await readFile("fixtures/live/sources.json", "utf8")) as { slug: string; url: string }[];
  for (const s of sources) targets.push({ name: `live-${s.slug}`, url: s.url, live: true });
}

let failed = 0;
const results: Record<string, PageReport> = {};
const selected = targets.filter((t) => args.only === undefined || t.name.includes(args.only));
for (const t of selected) {
  const r = await run(t.name, t.url, t.live).catch((e: unknown) => ({ status: "crash", initial: 0, tables: 0, columns: 0, problems: [String(e).split("\n")[0]!] }));
  results[t.name] = r;
  const ok = r.problems.length === 0 && (r.status === "done" || r.status === "none" || r.status === "off");
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${t.name.padEnd(42)} ${r.status.padEnd(6)} ${String(r.initial).padStart(2)}→${String(r.tables).padEnd(2)} tables ${String(r.columns).padStart(3)} columns`);
  for (const p of r.problems.slice(0, 8)) console.log(`    - ${p}`);
  if (r.problems.length > 8) console.log(`    … ${r.problems.length - 8} more`);
}
// ── Popup: turning a page or a site off ─────────────────────────────────────

const popupScenario = async (): Promise<string[]> => {
  const problems: string[] = [];
  // The toolbar button must open the popup (the popup itself is driven below by URL).
  const popupPath = await worker.evaluate(() => chrome.action.getPopup({}));
  if (!popupPath.endsWith("/popup.html")) problems.push(`toolbar button opens "${popupPath}", not popup.html`);
  const target = await context.newPage();
  await target.goto(`${base}/synthetic/dark-theme.html`, { waitUntil: "domcontentloaded" });
  if ((await waitForStatus(target)) !== "done") return ["popup: target page never finished"];
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id).filter((id) => id !== undefined).at(-1));
  const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html?tab=${tabId}`;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 260 });
  await popup.goto(popupUrl);
  await popup.waitForFunction(() => /shaded/.test(document.querySelector("#summary")?.textContent ?? ""), undefined, { timeout: 5000 }).catch(() => undefined);
  const summary = (await popup.textContent("#summary")) ?? "";
  if (!/\d+ columns? shaded in \d+ tables?/.test(summary)) problems.push(`popup summary reads "${summary}"`);
  await popup.screenshot({ path: "artifacts/screens/popup.png" });

  const painted = () => target.evaluate(() => document.querySelectorAll("[data-pd-t]:not([data-pd-t=''])").length);
  const status = () => target.evaluate(() => document.documentElement.dataset["pdStatus"]);

  // This page, off: clears now and stays off after a reload.
  await popup.click("label:has(#page)");
  await target.waitForFunction(() => document.documentElement.dataset["pdStatus"] === "off", undefined, { timeout: 5000 }).catch(() => undefined);
  if ((await painted()) > 0) problems.push("popup: 'Color this page' off left cells painted");
  await target.reload({ waitUntil: "domcontentloaded" });
  await target.waitForTimeout(800);
  if ((await status()) !== "off") problems.push(`popup: paused page came back after reload (status ${await status()})`);
  // And back on.
  await popup.reload();
  await popup.click("label:has(#page)");
  if ((await waitForStatus(target)) !== "done" || (await painted()) === 0) problems.push("popup: turning the page back on didn't repaint");

  // This site, off: persists across reloads; then restore.
  await popup.reload();
  await popup.click("label:has(#site)");
  await target.reload({ waitUntil: "domcontentloaded" });
  await target.waitForTimeout(800);
  if ((await status()) !== "off") problems.push(`popup: site switch didn't persist (status ${await status()})`);
  await popup.reload();
  await popup.click("label:has(#site)");
  await popup.close();
  await target.close();
  return problems;
};

// ── Per-table controls: rows/columns and hide ───────────────────────────────

const controlsScenario = async (): Promise<string[]> => {
  const problems: string[] = [];
  const page = await context.newPage();
  await page.goto(`${base}/live/cloudflare-clef.html`, { waitUntil: "domcontentloaded" });
  const table = page.locator("table").first();
  await table.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector("table")?.dataset["pdOrientation"] !== undefined, undefined, { timeout: 15_000, polling: 100 }).catch(() => undefined);
  const orientation = () => page.evaluate(() => document.querySelector("table")?.dataset["pdOrientation"] ?? "none");
  const painted = () => page.evaluate(() => document.querySelector("table")!.querySelectorAll("[data-pd-t]:not([data-pd-t=''])").length);
  if ((await orientation()) !== "rows") problems.push(`controls: benchmark table judged "${await orientation()}", expected rows`);
  const hover = async () => {
    const box = (await table.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.waitForTimeout(150);
  };
  const click = (name: string) => page.locator("[data-pd-controls] button", { hasText: name }).click();
  const waitFor = (fn: () => Promise<boolean>) =>
    (async () => {
      for (let i = 0; i < 50; i++) {
        if (await fn()) return true;
        await page.waitForTimeout(100);
      }
      return false;
    })();

  await hover();
  await page.screenshot({ path: "artifacts/screens/controls.png", clip: { ...(await table.boundingBox())!, y: Math.max(0, (await table.boundingBox())!.y - 50), height: 200 } });
  await click("Columns");
  if (!(await waitFor(async () => (await orientation()) === "columns"))) problems.push("controls: 'Columns' didn't re-shade by column");
  await hover();
  await click("Hide shading");
  if (!(await waitFor(async () => (await painted()) === 0))) problems.push("controls: 'Hide shading' left cells painted");
  await page.reload({ waitUntil: "domcontentloaded" });
  await table.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  if ((await painted()) > 0) problems.push("controls: hidden table came back after reload");
  await hover();
  await click("Show shading");
  if (!(await waitFor(async () => (await orientation()) === "columns" && (await painted()) > 0))) {
    problems.push(`controls: 'Show shading' should restore the reader's columns choice (got ${await orientation()})`);
  }
  await page.close();
  return problems;
};

// ── Lifecycle: what live pages do to tables after they're shaded ────────────

const lifecycleScenario = async (): Promise<string[]> => {
  const problems: string[] = [];
  const page = await context.newPage();
  await page.goto(`${base}/synthetic/lifecycle.html`, { waitUntil: "domcontentloaded" });
  if ((await waitForStatus(page)) !== "done") return [`lifecycle: status ${await page.evaluate(() => document.documentElement.dataset["pdStatus"])}`];
  const until = async (fn: () => Promise<boolean>, ms = 6000) => {
    for (let t = 0; t < ms; t += 150) {
      if (await fn()) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  const painted = (sel: string) => page.evaluate((s) => document.querySelectorAll(`${s} [data-pd-t]:not([data-pd-t=''])`).length, sel);

  // 1. Prices rewritten in place: the most expensive cell must end up at the bad end.
  await page.click("#reprice");
  const repriced = await until(() =>
    page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>("#prices tbody td:nth-child(2)")];
      const dear = cells.find((c) => c.textContent === "$9.00");
      return dear?.dataset["pdT"] === "0.000" && dear.parentElement!.querySelector("td")!.textContent === "Kettle";
    }),
  );
  if (!repriced) problems.push("lifecycle: shading didn't follow prices rewritten in place");

  // 2. Hide Standings, then insert a table above it: the choice must stay with Standings.
  const standings = page.locator("#standings");
  const box = (await standings.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.locator("[data-pd-controls] button", { hasText: "Hide shading" }).click();
  if (!(await until(async () => (await painted("#standings")) === 0))) problems.push("lifecycle: Hide shading didn't clear Standings");
  await page.click("#insert");
  await page.waitForTimeout(1500);
  await waitForStatus(page);
  if ((await painted("#standings")) > 0) problems.push("lifecycle: inserting a table above moved the hidden choice off Standings");
  if ((await painted("#prices")) === 0) problems.push("lifecycle: inserting a table above unshaded Prices");

  // 3. The page changes a shaded cell's style; turning shading off must keep that change.
  await page.click("#nudge");
  await worker.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined) await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: false }).catch(() => undefined);
    }
  });
  await until(() => page.evaluate(() => document.documentElement.dataset["pdStatus"] === "off"));
  const left = await page.evaluate(() => document.querySelector<HTMLElement>("#prices tbody td:nth-child(2)")!.style.left);
  if (left !== "3px") problems.push(`lifecycle: turning shading off undid the page's own style change (left="${left}")`);
  await worker.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined) await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: true }).catch(() => undefined);
    }
  });
  await waitForStatus(page);

  // 4. An oklch dark background must be read as dark: the ramp starts near the page, not near white.
  const rain = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#rain [data-pd-t]:not([data-pd-t=''])")].map((c) => getComputedStyle(c).backgroundColor),
  );
  const light = rain.filter((c) => (c.match(/\d+/g) ?? []).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) > 3 * 150);
  if (rain.length === 0) problems.push("lifecycle: the oklch dark table wasn't shaded");
  else if (light.length > 0) problems.push(`lifecycle: ${light.length} cells on the oklch dark background got light fills (${light[0]})`);

  // 5. In-app navigation: page 2 starts fresh, so Standings (hidden on page 1) is shaded again.
  await page.click("#navigate");
  if (!(await until(async () => (await painted("#standings")) > 0, 8000))) problems.push("lifecycle: after pushState, page 1's hidden choice still applied");

  await page.close();
  return problems;
};

const lifecycleProblems = await lifecycleScenario();
console.log(`${lifecycleProblems.length === 0 ? "✓" : "✗"} lifecycle: in-place edits, inserted tables, page styles, oklch, navigation`);
for (const p of lifecycleProblems) console.log(`    - ${p}`);
if (lifecycleProblems.length > 0) failed++;

const controlsProblems = await controlsScenario();
console.log(`${controlsProblems.length === 0 ? "✓" : "✗"} controls: rows/columns and hide`);
for (const p of controlsProblems) console.log(`    - ${p}`);
if (controlsProblems.length > 0) failed++;

const popupProblems = await popupScenario();
console.log(`${popupProblems.length === 0 ? "✓" : "✗"} popup: page and site switches`);
for (const p of popupProblems) console.log(`    - ${p}`);
if (popupProblems.length > 0) failed++;

await writeFile("artifacts/e2e.json", JSON.stringify(results, null, 1));
// Lazy judging sends intermediate table subsets whose page-level share request the eval never
// recorded; those runs fail harmlessly and the final full-set run replays.
if (args.offline && replayMisses > 0) console.log(`\n${replayMisses} intermediate API requests had no recording.`);
console.log(`\n${failed === 0 ? "All" : `${failed} failure(s);`} ${selected.length} pages and 3 scenarios checked. Screenshots: artifacts/screens/`);
await context.close();
server.close();
process.exitCode = failed > 0 ? 1 : 0;
