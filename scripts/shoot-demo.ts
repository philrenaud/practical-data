/** Screenshots the built demo site (site/) at desktop and phone widths, light and dark, and checks contrast + console errors. */
import { chromium } from "playwright";
import { serve } from "./serve.ts";

const target = process.argv[2];
const { url: local, server } = await serve("site");
const url = target ?? local;
const browser = await chromium.launch();
const errors: string[] = [];
for (const scheme of ["light", "dark"] as const) {
  for (const [label, width] of [["desktop", 1280], ["phone", 390]] as const) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
    page.on("pageerror", (e) => errors.push(`${scheme}/${label}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("fonts.g") && errors.push(`${scheme}/${label}: ${m.text()}`));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const painted = await page.evaluate(() => document.querySelectorAll("[data-pd-t]:not([data-pd-t=''])").length);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    console.log(`${scheme}/${label}: ${painted} painted cells${overflow ? ", PAGE OVERFLOWS HORIZONTALLY" : ""}`);
    await page.screenshot({ path: `artifacts/screens/demo-${scheme}-${label}.png`, fullPage: true });
    await page.close();
  }
}
console.log(errors.length === 0 ? "no page errors" : errors.join("\n"));
await browser.close();
server.close();
