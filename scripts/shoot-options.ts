/** Screenshots the options page in light and dark at desktop and phone widths into artifacts/screens/. */
import { chromium } from "playwright";

const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: ["--disable-extensions-except=dist", "--load-extension=dist"],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
const id = new URL(worker.url()).host;
await worker.evaluate(() =>
  chrome.storage.local.set({ settings: { provider: "jev", typesafeApiKey: "ts_example", palette: "classic", disabledHosts: ["news.ycombinator.com", "example.org"] } }),
);
for (const scheme of ["light", "dark"] as const) {
  for (const [label, width] of [["desktop", 1100], ["phone", 390]] as const) {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 1200 });
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.screenshot({ path: `artifacts/screens/options-${scheme}-${label}.png`, fullPage: true });
    await page.close();
  }
}
await context.close();
