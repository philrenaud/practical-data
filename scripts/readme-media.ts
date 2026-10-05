/**
 * Renders the README's images from docs/media-src/cards.html: the real
 * extractor, judge (recorded answers) and painter, screenshotted per card in
 * light and dark at 2× → docs/media/<card>-<theme>.png.
 */
import * as esbuild from "esbuild";
import { Effect } from "effect";
import { chromium } from "playwright";
import { DEFAULT_PALETTE } from "../src/core/palettes.ts";
import type { PageSnapshot } from "../src/core/types.ts";
import { judgePage } from "../src/decide/judge.ts";
import { recordedJev } from "./lib/cache.ts";
import { serve } from "./serve.ts";

await esbuild.build({ entryPoints: { media: "src/demo/media.ts" }, outdir: "dist-probe", bundle: true, format: "iife", logLevel: "warning" });

const layer = recordedJev();

const { url, server } = await serve("docs/media-src");
const browser = await chromium.launch();
type Media = { snapshot: () => PageSnapshot; paint: (j: unknown, p: string) => void };

for (const theme of ["light", "dark"] as const) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
  await page.goto(`${url}/cards.html`);
  await page.addScriptTag({ path: "dist-probe/media.js" });
  const snapshot = await page.evaluate(() => (globalThis as unknown as { __media: Media }).__media.snapshot());
  const judgment = await Effect.runPromise(judgePage({ ...snapshot, title: "Table examples" }).pipe(Effect.provide(layer)));
  await page.evaluate(([j, p]) => (globalThis as unknown as { __media: Media }).__media.paint(j, p), [judgment, DEFAULT_PALETTE] as const);
  await page.waitForTimeout(400);
  for (const card of await page.locator("[data-card]").all()) {
    const name = await card.getAttribute("data-card");
    await card.screenshot({ path: `docs/media/${name}-${theme}.png` });
    console.log(`docs/media/${name}-${theme}.png`);
  }
  await page.close();
}
await browser.close();
server.close();
