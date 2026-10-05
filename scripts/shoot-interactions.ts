/**
 * Exercises UI paths the e2e doesn't: the legend hover card on a painted page,
 * and the options page "Test" button calling the live model. Needs TYPESAFE_API_KEY.
 */
import { chromium } from "playwright";
import { serve } from "./serve.ts";

const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
const { url, server } = await serve("fixtures");
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  viewport: { width: 1200, height: 800 },
  args: ["--disable-extensions-except=dist", "--load-extension=dist"],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await worker.evaluate((k) => chrome.storage.local.set({ settings: { provider: "jev", typesafeApiKey: k, palette: "classic", disabledHosts: [] } }), apiKey);

const page = await context.newPage();
await page.goto(`${url}/live/github-copilot-pricing.html`);
// Tables are judged lazily, as they near the viewport.
await page.locator("table").first().scrollIntoViewIfNeeded();
await page.waitForFunction(() => document.documentElement.dataset["pdStatus"] === "done", undefined, { polling: 200 });
for (const [name, nth] of [["hover-card", 2], ["hover-card-ordinal", 0]] as const) {
  const header = page.locator("table[data-pd-table] [data-pd-legend]").nth(nth);
  await header.scrollIntoViewIfNeeded();
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const card = await page.evaluate(() => document.querySelector("[data-pd-card]")?.shadowRoot?.querySelector(".card")?.textContent ?? "");
  console.log(`${name}:`, card);
  await page.screenshot({ path: `artifacts/screens/${name}.png`, clip: { x: Math.max(0, box.x - 260), y: Math.max(0, box.y - 40), width: 640, height: 340 } });
  await page.mouse.move(5, 5);
}

const id = new URL(worker.url()).host;
const options = await context.newPage();
await options.goto(`chrome-extension://${id}/options.html`);
await options.click("#test");
await options.waitForFunction(() => !/Asking/.test(document.querySelector("#status")?.textContent ?? "Asking"), undefined, { timeout: 20_000 });
console.log("options test:", await options.textContent("#status"));
await options.screenshot({ path: "artifacts/screens/options-tested.png", fullPage: true });

await context.close();
server.close();
