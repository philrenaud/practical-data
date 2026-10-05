/**
 * Extracts every fixture page to fixtures/snapshots/<slug>.json using the same
 * extractor the content script runs. Outside network is blocked so pages
 * render from the saved HTML alone.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fixturePages, serve } from "./serve.ts";

const { url, server } = await serve("fixtures");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.route("**/*", (route) =>
  route.request().url().startsWith(url) ? route.continue() : route.abort(),
);
await mkdir("fixtures/snapshots", { recursive: true });

for (const { slug, path } of await fixturePages()) {
  const page = await context.newPage();
  await page.goto(`${url}/${path}`, { waitUntil: "domcontentloaded" });
  // Snapshot the expanded state: that is what gets judged once a user clicks [show].
  for (const toggle of await page.locator("[data-e2e-expand]").all()) await toggle.click();
  await page.addScriptTag({ path: "dist-probe/probe.js" });
  const snapshot = await page.evaluate(() =>
    (globalThis as unknown as { __practicalData: { extractPage: () => unknown } }).__practicalData.extractPage(),
  );
  const s = snapshot as { tables: { id: string; headers: string[]; rows: unknown[] }[] };
  await writeFile(`fixtures/snapshots/${slug}.json`, JSON.stringify({ ...s, url: `fixture://${path}` }, null, 1));
  console.log(slug.padEnd(36), s.tables.map((t) => `${t.id}:${t.headers.length}×${t.rows.length}`).join(" "));
  await page.close();
}
await browser.close();
server.close();
