/**
 * Saves a page's DOM after its scripts have run, for fixtures whose tables
 * are built client-side. Scripts are stripped so the copy stays static.
 *
 *   node scripts/save-rendered.ts <url> <slug>   # → fixtures/live/<slug>.html
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const [url, slug] = process.argv.slice(2);
if (url === undefined || slug === undefined) throw new Error("usage: node scripts/save-rendered.ts <url> <slug>");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(3000);
const html = await page.evaluate(() => {
  document.querySelectorAll("script, noscript, iframe").forEach((el) => el.remove());
  const base = document.createElement("base");
  base.href = location.href;
  document.head.prepend(base);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
});
await writeFile(`fixtures/live/${slug}.html`, html);
console.log(`fixtures/live/${slug}.html: ${html.length.toLocaleString()} bytes, ${(html.match(/<tr/g) ?? []).length} rows`);
await browser.close();
