/**
 * Loads dist/ as an unpacked extension in Chromium, opens every fixture page,
 * and checks what a user sees.
 *
 *   node scripts/e2e.ts             # calls the decision API and records answers (needs TYPESAFE_API_KEY)
 *   node scripts/e2e.ts --offline   # answers API calls from fixtures/recordings
 *   node scripts/e2e.ts --live      # also visits the real URLs in fixtures/live/sources.json
 *   node scripts/e2e.ts --headed
 *
 * On each page, it checks the following:
 *
 * - The pipeline finishes.
 * - Every encoded column paints all of its non-missing cells.
 * - Text on painted cells keeps a contrast ratio of at least 4.5:1.
 * - In a directional column, the best cell is greener than the worst.
 * - Legend headers carry the gradient underline.
 * - Painting changes no column width.
 * - A collapsed table is judged after it expands.
 * - Turning shading off restores the original markup exactly.
 * - A table marked `data-e2e-skip` (an app list) is not judged.
 *
 * Then it runs three scenarios: page lifecycle, per-table controls, and the
 * popup. Screenshots go to artifacts/screens/.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { chromium, type BrowserContext, type Page, type Route } from "playwright";
import { PAGE_HOST, buildTestExtension, fixturePages, serve } from "./serve.ts";

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

const { pagesUrl: base, url: loopback, server } = await serve("fixtures");
await mkdir("artifacts/screens", { recursive: true });

/**
 * The proxy for live API calls, when the environment sets one. Chromium ignores
 * HTTPS_PROXY, so `route.fetch()` would skip a proxy that a sandbox requires.
 * The fixture server stays direct.
 */
const proxy =
  process.env["HTTPS_PROXY"] === undefined || process.env["HTTPS_PROXY"] === ""
    ? undefined
    : { server: process.env["HTTPS_PROXY"], bypass: `127.0.0.1,localhost,${PAGE_HOST}` };

const extensionArgs = buildTestExtension();

/** Starts Chromium with dist-e2e/ loaded in a fresh profile. */
const launch = async (): Promise<BrowserContext> => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: !args.headed,
    viewport: { width: 1360, height: 900 },
    args: extensionArgs,
    ...(proxy === undefined ? {} : { proxy }),
  });
  await context.route("**/*", routeRequest);
  return context;
};

/** Settings for every run: the Jev provider, so offline runs replay fixtures/recordings. */
const SETTINGS = {
  provider: "jev",
  typesafeApiKey: args.offline ? "offline" : apiKey,
  palette: "classic",
  disabledHosts: [],
};

// Fixture pages get no network access. Decision API calls go live or replay from recordings.
let replayMisses = 0;
const routeRequest = async (route: Route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(base) || url.startsWith(loopback) || url.startsWith("chrome-extension://"))
    return route.continue();
  if (url.startsWith("https://api.typesafe.ai/")) {
    // Use the AnswerCache key, the SHA-256 of the exact JSON body.
    const key = createHash("sha256")
      .update(req.postData() ?? "")
      .digest("hex");
    if (!args.offline) {
      // Record each live answer, so an offline run can replay every request that this run made.
      // A failed call reaches the extension as a network error, as it would in a browser.
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
  // Load live sites unmodified. Blocking their images triggers ad-block walls that lock scrolling.
  if (args.live) return route.continue();
  return route.abort();
};

const context = await launch();
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await worker.evaluate((settings) => chrome.storage.local.set({ settings }), SETTINGS);
// The worker opens the options page on first install. Close it.
for (const p of context.pages()) if (p.url().includes("options.html")) await p.close();

interface PageReport {
  status: string;
  /** The number of tables judged before scrolling. On long pages, lazy judging keeps it below `tables`. */
  initial: number;
  tables: number;
  columns: number;
  problems: string[];
}

/** Checks the painted state. Runs inside the page. */
const inspect = () => {
  // Resolve any CSS color, such as oklch() or color-mix(), to sRGB through a 1-pixel canvas, as the painter does.
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const toRgb = (css: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  const lum = (css: string) => {
    const m = toRgb(css)
      .match(/[\d.]+/g)!
      .map(Number);
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
    const m = toRgb(c)
      .match(/[\d.]+/g)!
      .map(Number);
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
        if (ratio < 4.5)
          problems.push(`${id} col ${col}: contrast ${ratio.toFixed(2)} on "${c.innerText.slice(0, 20)}"`);
      }
      if (kind === "higher_is_better" || kind === "lower_is_better") {
        const byT = painted.map((c) => [Number(c.dataset["pdT"]), c] as const).sort((a, b) => a[0] - b[0]);
        const worst = byT[0]![1];
        const best = byT.at(-1)![1];
        if (
          byT.at(-1)![0] - byT[0]![0] > 0.5 &&
          greenness(getComputedStyle(best).backgroundColor) <= greenness(getComputedStyle(worst).backgroundColor)
        ) {
          problems.push(`${id} col ${col}: best cell is not greener than worst`);
        }
      }
    }
    const legends = table.querySelectorAll<HTMLElement>("[data-pd-legend]");
    if (legends.length === 0 && encoded.length > 0) problems.push(`${id}: no header carries a legend`);
    for (const h of legends) {
      if (!getComputedStyle(h).backgroundImage.includes("gradient"))
        problems.push(`${id}: header "${h.innerText.slice(0, 20)}" has no underline`);
    }
  }
  // Fixture tables marked data-e2e-skip are app lists, which the extractor must skip.
  for (const t of document.querySelectorAll<HTMLTableElement>("table[data-e2e-skip]")) {
    if (t.hasAttribute("data-pd-table")) problems.push(`#${t.id}: an app list was judged`);
  }
  return {
    tables: tables.length,
    columns,
    problems,
    encoded: tables.map((t) => `${t.dataset["pdTable"]}=${t.dataset["pdEncoded"]}`),
  };
};

/** Waits for a settled status. It waits past "idle", which means that the page has tables but none near the viewport yet. */
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

/** Returns the outerHTML of every table, to prove that turning shading off restores the markup exactly. */
const markup = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("table")].map((t, i) => `<!--table ${i}-->${t.outerHTML}`).join("\n"),
  );

/** Long pages where some tables start well below the fold. */
const LAZY_PAGES = ["bbref-aaron-judge", "wiki-mtg-sets"];

const run = async (name: string, url: string, live: boolean): Promise<PageReport> => {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Saved Baseball-Reference pages hide #content until the site's script runs. Offline, that script never runs.
  if (!live && name.startsWith("bbref-"))
    await page.addStyleTag({ content: "#content { display: block !important; }" });
  // Capture the untouched markup as early as possible for the restore check.
  const before = await markup(page);
  let status = await waitForStatus(page);
  let toggles: Awaited<ReturnType<ReturnType<Page["locator"]>["all"]>> = [];
  const initial = await page.evaluate(() => document.querySelectorAll("table[data-pd-table]").length);
  if (status === "done" || status === "idle") {
    // Scroll through the page as a user would, so that lazily judged tables get painted.
    // Wait for load first, because some sites, such as Baseball-Reference, reset the scroll position on load.
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
    await page.mouse.move(400, 400);
    for (let i = 0; i < 200; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(120);
      const atEnd = await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2);
      if (atEnd) break;
    }
    await page.waitForTimeout(800);
    // Expand collapsed tables as a user would. Each one must be judged after it expands.
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
  // The extension must not touch a page that opts out. The demo site opts out because it paints itself.
  const optedOut = await page.evaluate(
    () => document.querySelector('meta[name="practical-data"][content="off"]') !== null,
  );
  if (optedOut) {
    if (status !== "off") report.problems.push(`opted-out page has status ${status}`);
    if ((await page.evaluate(() => document.querySelectorAll("[data-pd-t], [data-pd-table]").length)) > 0) {
      report.problems.push("opted-out page was painted");
    }
    await page.close();
    return report;
  }
  if (status === "done") {
    // Wait for background transitions, and any repaint by the page's own scripts, to finish.
    await page
      .waitForFunction(() => document.getAnimations().length === 0, undefined, { polling: 100, timeout: 10_000 })
      .catch(() => undefined);
    Object.assign(report, await page.evaluate(inspect));
    const unpaintedExpanded = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-e2e-expand]")].filter(
          (t) => t.closest("table")?.querySelector("[data-pd-t]:not([data-pd-t=''])") == null,
        ).length,
    );
    if (unpaintedExpanded > 0) report.problems.push(`${unpaintedExpanded} expanded table(s) never got painted`);
    const first = page.locator("table[data-pd-table]").first();
    await first.scrollIntoViewIfNeeded().catch(() => undefined);
    // Playwright hides the caret with an inline style on each input and leaves style="", which the restore check would catch.
    await page.screenshot({ path: `artifacts/screens/${name}.png`, caret: "initial" });
    // Toggle off through the same message the toolbar button sends.
    const thWidths = () =>
      page.evaluate(() => [...document.querySelectorAll("th")].map((h) => h.getBoundingClientRect().width));
    const paintedWidths = await thWidths();
    // Without the "tabs" permission, the worker cannot match tabs by URL. Only this page is open, so send to every tab.
    await worker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id !== undefined)
          await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: false }).catch(() => undefined);
      }
    });
    await page.waitForFunction(() => document.documentElement.dataset["pdStatus"] === "off", undefined, {
      polling: 100,
    });
    // Painting must not change layout. Each header must keep its width after the paint is removed.
    const plainWidths = await thWidths();
    const shifted = plainWidths.filter((w, i) => Math.abs(w - (paintedWidths[i] ?? w)) > 1).length;
    if (shifted > 0) report.problems.push(`painting changed the width of ${shifted} header cell(s)`);
    const leftovers = await page.evaluate(
      () => document.querySelectorAll("[data-pd-styled], [data-pd-t], [data-pd-table], [data-pd-legend]").length,
    );
    if (leftovers > 0) report.problems.push(`toggle off left ${leftovers} painted elements behind`);
    // Exact markup equality holds only on saved pages, whose scripts do not rewrite tables,
    // and only if this test did not expand a table.
    const after = await markup(page);
    if (!live && toggles.length === 0 && after !== before) {
      let i = 0;
      while (i < after.length && after[i] === before[i]) i++;
      const which =
        before
          .slice(0, i)
          .match(/<!--table (\d+)-->/g)
          ?.at(-1) ?? "?";
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
  const r = await run(t.name, t.url, t.live).catch((e: unknown) => ({
    status: "crash",
    initial: 0,
    tables: 0,
    columns: 0,
    problems: [String(e).split("\n")[0]!],
  }));
  results[t.name] = r;
  const ok = r.problems.length === 0 && (r.status === "done" || r.status === "none" || r.status === "off");
  if (!ok) failed++;
  console.log(
    `${ok ? "✓" : "✗"} ${t.name.padEnd(42)} ${r.status.padEnd(6)} ${String(r.initial).padStart(2)}→${String(r.tables).padEnd(2)} tables ${String(r.columns).padStart(3)} columns`,
  );
  for (const p of r.problems.slice(0, 8)) console.log(`    - ${p}`);
  if (r.problems.length > 8) console.log(`    … ${r.problems.length - 8} more`);
}
// ── Popup: turning a page or a site off ─────────────────────────────────────

const popupScenario = async (): Promise<string[]> => {
  const problems: string[] = [];
  // The toolbar button must open the popup. The steps below open the popup by URL.
  const popupPath = await worker.evaluate(() => chrome.action.getPopup({}));
  if (!popupPath.endsWith("/popup.html")) problems.push(`toolbar button opens "${popupPath}", not popup.html`);
  const target = await context.newPage();
  await target.goto(`${base}/synthetic/dark-theme.html`, { waitUntil: "domcontentloaded" });
  if ((await waitForStatus(target)) !== "done") return ["popup: target page never finished"];
  const tabId = await worker.evaluate(async () =>
    (await chrome.tabs.query({}))
      .map((t) => t.id)
      .filter((id) => id !== undefined)
      .at(-1),
  );
  const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html?tab=${tabId}`;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 260 });
  await popup.goto(popupUrl);
  await popup
    .waitForFunction(() => /shaded/.test(document.querySelector("#summary")?.textContent ?? ""), undefined, {
      timeout: 5000,
    })
    .catch(() => undefined);
  const summary = (await popup.textContent("#summary")) ?? "";
  if (!/\d+ columns? shaded in \d+ tables?/.test(summary)) problems.push(`popup summary reads "${summary}"`);
  await popup.screenshot({ path: "artifacts/screens/popup.png" });

  const painted = () => target.evaluate(() => document.querySelectorAll("[data-pd-t]:not([data-pd-t=''])").length);
  const status = () => target.evaluate(() => document.documentElement.dataset["pdStatus"]);

  // Turning this page off clears the shading now and after a reload.
  await popup.click("label:has(#page)");
  await target
    .waitForFunction(() => document.documentElement.dataset["pdStatus"] === "off", undefined, { timeout: 5000 })
    .catch(() => undefined);
  if ((await painted()) > 0) problems.push("popup: 'Color this page' off left cells painted");
  await target.reload({ waitUntil: "domcontentloaded" });
  await target.waitForTimeout(800);
  if ((await status()) !== "off") problems.push(`popup: paused page came back after reload (status ${await status()})`);
  // Turn the page back on.
  await popup.reload();
  await popup.click("label:has(#page)");
  if ((await waitForStatus(target)) !== "done" || (await painted()) === 0)
    problems.push("popup: turning the page back on didn't repaint");

  // Turning this site off persists across reloads. Then turn the site back on.
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

// ── Private hosts ───────────────────────────────────────────────────────────

/** A page on 127.0.0.1 is off until the user turns the site on, and sends nothing before that. */
const privateHostScenario = async (): Promise<string[]> => {
  const problems: string[] = [];
  const target = await context.newPage();
  await target.goto(`${loopback}/synthetic/dark-theme.html`, { waitUntil: "domcontentloaded" });
  await target.waitForTimeout(1500);
  const status = () => target.evaluate(() => document.documentElement.dataset["pdStatus"]);
  const judged = await target.evaluate(() => document.querySelectorAll("[data-pd-t]:not([data-pd-t=''])").length > 0);
  if ((await status()) !== "off") problems.push(`private host: status ${await status()}, not off`);
  if (judged) problems.push("private host: cells painted before the site was turned on");

  const tabId = await worker.evaluate(async () =>
    (await chrome.tabs.query({}))
      .map((t) => t.id)
      .filter((id) => id !== undefined)
      .at(-1),
  );
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html?tab=${tabId}`);
  await popup.waitForTimeout(300);
  const summary = (await popup.textContent("#summary")) ?? "";
  if (!/private network/.test(summary)) problems.push(`private host: popup reads "${summary}"`);
  await popup.click("label:has(#site)");
  await target.reload({ waitUntil: "domcontentloaded" });
  if ((await waitForStatus(target)) !== "done") problems.push("private host: turning the site on didn't shade it");
  // Turn the site off again, so that the setting does not carry into other scenarios.
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
  await page
    .waitForFunction(() => document.querySelector("table")?.dataset["pdOrientation"] !== undefined, undefined, {
      timeout: 15_000,
      polling: 100,
    })
    .catch(() => undefined);
  const orientation = () => page.evaluate(() => document.querySelector("table")?.dataset["pdOrientation"] ?? "none");
  const painted = () =>
    page.evaluate(() => document.querySelector("table")!.querySelectorAll("[data-pd-t]:not([data-pd-t=''])").length);
  if ((await orientation()) !== "rows")
    problems.push(`controls: benchmark table judged "${await orientation()}", expected rows`);
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
  await page.screenshot({
    path: "artifacts/screens/controls.png",
    clip: { ...(await table.boundingBox())!, y: Math.max(0, (await table.boundingBox())!.y - 50), height: 200 },
  });
  // Page rules that match the shadow hosts must not give them a box.
  await page.addStyleTag({ content: "html > span { display: block !important; padding: 40px !important; }" });
  const hostSizes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-pd-controls], [data-pd-card]")].map((h) => {
      const r = h.getBoundingClientRect();
      return r.width * r.height;
    }),
  );
  if (hostSizes.length === 0 || hostSizes.some((a) => a > 0))
    problems.push(`controls: page CSS gave the shadow hosts a box (areas ${hostSizes.join(", ")})`);
  await click("Columns");
  if (!(await waitFor(async () => (await orientation()) === "columns")))
    problems.push("controls: 'Columns' didn't re-shade by column");
  await hover();
  await click("Hide shading");
  if (!(await waitFor(async () => (await painted()) === 0)))
    problems.push("controls: 'Hide shading' left cells painted");
  await page.reload({ waitUntil: "domcontentloaded" });
  await table.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  if ((await painted()) > 0) problems.push("controls: hidden table came back after reload");
  await hover();
  await click("Show shading");
  if (!(await waitFor(async () => (await orientation()) === "columns" && (await painted()) > 0))) {
    problems.push(`controls: 'Show shading' should restore the user's columns choice (got ${await orientation()})`);
  }
  await page.close();
  return problems;
};

// ── Lifecycle: what live pages do to tables after they're shaded ────────────

const lifecycleScenario = async (): Promise<string[]> => {
  const problems: string[] = [];
  const page = await context.newPage();
  await page.goto(`${base}/synthetic/lifecycle.html`, { waitUntil: "domcontentloaded" });
  if ((await waitForStatus(page)) !== "done")
    return [`lifecycle: status ${await page.evaluate(() => document.documentElement.dataset["pdStatus"])}`];
  const until = async (fn: () => Promise<boolean>, ms = 6000) => {
    for (let t = 0; t < ms; t += 150) {
      if (await fn()) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  const painted = (sel: string) =>
    page.evaluate((s) => document.querySelectorAll(`${s} [data-pd-t]:not([data-pd-t=''])`).length, sel);

  // 1. The page rewrites prices in place. The most expensive cell must end up at the bad end.
  await page.click("#reprice");
  const repriced = await until(() =>
    page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>("#prices tbody td:nth-child(2)")];
      const dear = cells.find((c) => c.textContent === "$9.00");
      return dear?.dataset["pdT"] === "0.000" && dear.parentElement!.querySelector("td")!.textContent === "Kettle";
    }),
  );
  if (!repriced) problems.push("lifecycle: shading didn't follow prices rewritten in place");

  // 2. Hide Standings, then insert a table above it. The hidden choice must stay with Standings.
  const standings = page.locator("#standings");
  const box = (await standings.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.locator("[data-pd-controls] button", { hasText: "Hide shading" }).click();
  if (!(await until(async () => (await painted("#standings")) === 0)))
    problems.push("lifecycle: Hide shading didn't clear Standings");
  await page.click("#insert");
  await page.waitForTimeout(1500);
  await waitForStatus(page);
  if ((await painted("#standings")) > 0)
    problems.push("lifecycle: inserting a table above moved the hidden choice off Standings");
  if ((await painted("#prices")) === 0) problems.push("lifecycle: inserting a table above unshaded Prices");

  // 3. The page changes a shaded cell's style. Turning shading off must keep that change.
  await page.click("#nudge");
  await worker.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined)
        await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: false }).catch(() => undefined);
    }
  });
  await until(() => page.evaluate(() => document.documentElement.dataset["pdStatus"] === "off"));
  const left = await page.evaluate(
    () => document.querySelector<HTMLElement>("#prices tbody td:nth-child(2)")!.style.left,
  );
  if (left !== "3px")
    problems.push(`lifecycle: turning shading off undid the page's own style change (left="${left}")`);
  await worker.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined)
        await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: true }).catch(() => undefined);
    }
  });
  await waitForStatus(page);

  // 4. An oklch() dark background must be read as dark, so the ramp starts near the page color, not near white.
  const rain = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#rain [data-pd-t]:not([data-pd-t=''])")].map(
      (c) => getComputedStyle(c).backgroundColor,
    ),
  );
  const light = rain.filter(
    (c) =>
      (c.match(/\d+/g) ?? [])
        .slice(0, 3)
        .map(Number)
        .reduce((a, b) => a + b, 0) >
      3 * 150,
  );
  if (rain.length === 0) problems.push("lifecycle: the oklch dark table wasn't shaded");
  else if (light.length > 0)
    problems.push(`lifecycle: ${light.length} cells on the oklch dark background got light fills (${light[0]})`);

  // 5. After in-app navigation, page 2 starts fresh, so Standings is shaded again.
  await page.click("#navigate");
  if (!(await until(async () => (await painted("#standings")) > 0, 8000)))
    problems.push("lifecycle: after pushState, page 1's hidden choice still applied");

  await page.close();
  return problems;
};

// ── Extractor: malformed markup and editable tables ─────────────────────────

const malformedScenario = async (): Promise<string[]> => {
  const page = await context.newPage();
  // Row "B" has one cell, and the rowspan above reaches its fourth slot: a hole at slots 1 and 2.
  await page.setContent(`
    <table><tr><td>A</td><td>1</td><td>2</td><td rowspan="2">3</td></tr><tr><td>B</td></tr>
      <tr><td>C</td><td>4</td><td>5</td><td>6</td></tr><tr><td>D</td><td>7</td><td>8</td><td>9</td></tr></table>
    <table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>
    <div contenteditable=""><table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table></div>
    <div contenteditable="plaintext-only"><table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table></div>`);
  await page.addScriptTag({ path: "dist-probe/probe.js" });
  const result = await page.evaluate(() => {
    try {
      const probe = (globalThis as unknown as { __practicalData: { extractPage: () => unknown } }).__practicalData;
      return probe.extractPage() as { tables: { rows: unknown[][] }[] };
    } catch (e) {
      return String(e);
    }
  });
  await page.close();
  if (typeof result === "string") return [`malformed: extraction threw (${result})`];
  const problems: string[] = [];
  // The editable tables are left out: styles painted into an editor would be saved with the document.
  if (result.tables.length !== 2) problems.push(`malformed: expected 2 tables, got ${result.tables.length}`);
  const rows = result.tables.flatMap((t) => t.rows);
  if (rows.some((r) => r.some((c) => typeof c !== "string")))
    problems.push("malformed: a snapshot row has a missing cell");
  return problems;
};

const malformedProblems = await malformedScenario();
console.log(`${malformedProblems.length === 0 ? "✓" : "✗"} extractor: a row with a hole, editable tables`);
for (const p of malformedProblems) console.log(`    - ${p}`);
if (malformedProblems.length > 0) failed++;

// ── Cold start: a page that loads as soon as the extension does ────────────

/**
 * Covers a fresh install, or a browser restart that restores tabs. The page
 * loads while the service worker is still starting, so the worker may not yet
 * have opened storage.session to content scripts.
 */
const coldStartScenario = async (): Promise<string[]> => {
  const cold = await launch();
  try {
    const page = await cold.newPage();
    const coldWorker = cold.serviceWorkers()[0] ?? (await cold.waitForEvent("serviceworker"));
    // Don't wait for the settings write: an awaited round trip gives the worker time to finish starting.
    await Promise.all([
      coldWorker.evaluate((settings) => chrome.storage.local.set({ settings }), SETTINGS),
      page.goto(`${base}/synthetic/dark-theme.html`, { waitUntil: "domcontentloaded" }),
    ]);
    const status = await waitForStatus(page);
    if (status !== "done") return [`cold start: status ${status}`];
    const painted = await page.evaluate(() => document.querySelectorAll("[data-pd-t]:not([data-pd-t=''])").length);
    return painted > 0 ? [] : ["cold start: nothing painted"];
  } finally {
    await cold.close();
  }
};

// ── Storage: what the content script's context can read ────────────────────

/** The content script's isolated world must read neither storage area: they hold API keys and visited URLs. */
const storageScenario = async (): Promise<string[]> => {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; auxData?: { type?: string } }[] = [];
  cdp.on("Runtime.executionContextCreated", (e) => worlds.push(e.context));
  await cdp.send("Runtime.enable");
  await page.goto(`${base}/synthetic/dark-theme.html`, { waitUntil: "domcontentloaded" });
  await waitForStatus(page);
  const world = worlds.findLast((w) => w.auxData?.type === "isolated");
  if (world === undefined) return ["storage: found no content-script world"];
  const read = async (area: string) =>
    (
      await cdp.send("Runtime.evaluate", {
        contextId: world.id,
        awaitPromise: true,
        expression: `chrome.storage.${area}.get(null).then((items) => "read " + Object.keys(items).join(","), (e) => String(e))`,
      })
    ).result.value as string;
  const problems: string[] = [];
  const local = await read("local");
  if (local.startsWith("read")) problems.push(`storage: the content script can read storage.local (${local})`);
  const session = await read("session");
  if (session.startsWith("read")) problems.push(`storage: the content script can read storage.session (${session})`);
  // The popup's site switch, sent from the content script's world, must change nothing.
  await cdp.send("Runtime.evaluate", {
    contextId: world.id,
    awaitPromise: true,
    expression: `chrome.runtime.sendMessage({ type: "setSiteEnabled", tabId: 0, host: "fixtures.test", enabled: false }).catch(() => undefined)`,
  });
  const disabled = await worker.evaluate(
    async () => ((await chrome.storage.local.get("settings"))["settings"] as { disabledHosts: string[] }).disabledHosts,
  );
  if (disabled.length > 0) problems.push(`storage: a content script turned off ${disabled.join(", ")}`);
  await page.close();
  return problems;
};

// ── Live pages: a table that changes every second ──────────────────────────

/** Changed text misses the answer cache, so judge requests from page changes must back off. */
const liveScenario = async (): Promise<string[]> => {
  const page = await context.newPage();
  const url = `${base}/__ticker.html`;
  await page.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Ticker</title><table id="t">
        <thead><tr><th>Symbol</th><th>Price</th><th>Change</th></tr></thead>
        <tbody>${["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].map((s, i) => `<tr><td>${s}</td><td>${10 + i}.00</td><td>${i - 3}%</td></tr>`).join("")}</tbody>
      </table>
      <script>
        // Count judge requests: content.ts sets data-pd-status to "working" for each one.
        window.judges = 0;
        new MutationObserver(() => {
          if (document.documentElement.dataset.pdStatus === "working") window.judges++;
        }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-pd-status"] });
        let n = 0;
        setInterval(() => { document.querySelector("#t tbody td:nth-child(2)").textContent = (20 + ++n / 100).toFixed(2); }, 1000);
      </script>`,
    }),
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(16_000);
  const judges = await page.evaluate(() => (window as unknown as { judges: number }).judges);
  await page.close();
  // Unpaced, a change every second sends about 16. Paced, the waits are 0.6, 1.2, 2.4, 4.8, and 9.6 seconds.
  return judges <= 6 ? [] : [`live: ${judges} judge requests in 16 seconds`];
};

// ── Navigation: an off page that navigates in-app to a page that is on ─────

/** The content script polls for navigation only while shading is on, so an off page must hear navigation events. */
const navigationScenario = async (): Promise<string[]> => {
  const url = `${base}/synthetic/lifecycle.html`;
  await worker.evaluate((page) => chrome.storage.session.set({ pausedPages: [page] }), url);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const before = await waitForStatus(page);
    if (before !== "off") return [`navigation: paused page has status ${before}`];
    await page.click("#navigate");
    const after = await waitForStatus(page);
    return after === "done" ? [] : [`navigation: after pushState from a paused page, status ${after}`];
  } finally {
    await page.close();
    await worker.evaluate(() => chrome.storage.session.remove("pausedPages"));
  }
};

const navigationProblems = await navigationScenario();
console.log(
  `${navigationProblems.length === 0 ? "✓" : "✗"} navigation: an off page navigates in-app to one that is on`,
);
for (const p of navigationProblems) console.log(`    - ${p}`);
if (navigationProblems.length > 0) failed++;

const liveProblems = await liveScenario();
console.log(`${liveProblems.length === 0 ? "✓" : "✗"} live: a table that changes every second backs off`);
for (const p of liveProblems) console.log(`    - ${p}`);
if (liveProblems.length > 0) failed++;

const storageProblems = await storageScenario();
console.log(`${storageProblems.length === 0 ? "✓" : "✗"} storage: content scripts can't read storage or flip switches`);
for (const p of storageProblems) console.log(`    - ${p}`);
if (storageProblems.length > 0) failed++;

const coldStartProblems = await coldStartScenario();
console.log(`${coldStartProblems.length === 0 ? "✓" : "✗"} cold start: page opened as the extension loads`);
for (const p of coldStartProblems) console.log(`    - ${p}`);
if (coldStartProblems.length > 0) failed++;

const lifecycleProblems = await lifecycleScenario();
console.log(
  `${lifecycleProblems.length === 0 ? "✓" : "✗"} lifecycle: in-place edits, inserted tables, page styles, oklch, navigation`,
);
for (const p of lifecycleProblems) console.log(`    - ${p}`);
if (lifecycleProblems.length > 0) failed++;

const controlsProblems = await controlsScenario();
console.log(`${controlsProblems.length === 0 ? "✓" : "✗"} controls: rows/columns and hide`);
for (const p of controlsProblems) console.log(`    - ${p}`);
if (controlsProblems.length > 0) failed++;

const privateHostProblems = await privateHostScenario();
console.log(`${privateHostProblems.length === 0 ? "✓" : "✗"} private host: off until the user turns it on`);
for (const p of privateHostProblems) console.log(`    - ${p}`);
if (privateHostProblems.length > 0) failed++;

const popupProblems = await popupScenario();
console.log(`${popupProblems.length === 0 ? "✓" : "✗"} popup: page and site switches`);
for (const p of popupProblems) console.log(`    - ${p}`);
if (popupProblems.length > 0) failed++;

await writeFile("artifacts/e2e.json", JSON.stringify(results, null, 1));
// Lazy judging sends share requests for intermediate sets of tables, which the eval never recorded.
// Those requests fail without effect, and the request for the full set of tables replays.
if (args.offline && replayMisses > 0) console.log(`\n${replayMisses} intermediate API requests had no recording.`);
console.log(
  `\n${failed === 0 ? "All" : `${failed} failure(s);`} ${selected.length} pages and 9 scenarios checked. Screenshots: artifacts/screens/`,
);
await context.close();
server.close();
process.exitCode = failed > 0 ? 1 : 0;
