/**
 * Answers "why was / wasn't this column colored?" for any URL.
 *
 *   node scripts/explain-url.ts <url> [--table t3] [--wait 5000]
 *
 * Loads the page in Chromium (CSP bypassed so the extractor can be injected),
 * runs the same extractor and judge the extension uses, and prints every
 * table's columns with the decision and the reason or probabilities behind it.
 * Answers are cached in fixtures/recordings like the eval.
 */
import { parseArgs } from "node:util";
import { Effect } from "effect";
import { chromium } from "playwright";
import { profileTable } from "../src/core/profile.ts";
import type { PageSnapshot } from "../src/core/types.ts";
import { judgePage } from "../src/decide/judge.ts";
import { recordedJev } from "./lib/cache.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { table: { type: "string" }, wait: { type: "string", default: "5000" } },
});
const url = positionals[0];
if (url === undefined) throw new Error("usage: node scripts/explain-url.ts <url> [--table t3]");

const browser = await chromium.launch();
const page = await browser.newPage({ bypassCSP: true, viewport: { width: 1400, height: 1000 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(Number(args.wait));
await page.addScriptTag({ path: "dist-probe/probe.js" });
const snapshot = (await page.evaluate(() =>
  (globalThis as unknown as { __practicalData: { extractPage: () => unknown } }).__practicalData.extractPage(),
)) as PageSnapshot;
const rawTables = await page.evaluate(() => document.querySelectorAll("table").length);
await browser.close();

const judgment = await Effect.runPromise(
  judgePage(snapshot).pipe(
    Effect.provide(recordedJev()),
  ),
);

console.log(`${snapshot.title}\n${rawTables} <table> elements, ${snapshot.tables.length} extracted, ${judgment.usage.requests} requests, ${judgment.usage.inputTokens.toLocaleString()} tokens\n`);
for (const table of snapshot.tables) {
  if (args.table !== undefined && table.id !== args.table) continue;
  const j = judgment.tables.find((t) => t.id === table.id);
  console.log(`${table.id} "${table.title ?? ""}" ${table.headers.length} cols × ${table.rows.length} rows${j === undefined ? "  (not judged: under 3 rows or 2 columns)" : ""}`);
  if (j === undefined) continue;
  if (j.aggregateRows.length > 0) console.log(`   aggregate rows: ${j.aggregateRows.join(", ")}`);
  const profiles = profileTable(table);
  table.headers.forEach((h, col) => {
    const e = j.encodings.find((x) => x.col === col);
    const s = j.skipped.find((x) => x.col === col);
    const kind = profiles[col]?.kind ?? "?";
    const name = (h || `(col ${col})`).slice(0, 34).padEnd(34);
    if (e?.kind === "quantitative") {
      const p = e.evidence.polarity;
      console.log(`   ✓ ${name} ${e.polarity} ${e.transform}  measure=${e.evidence.comparable.toFixed(2)} ↑${p.higher_is_better.toFixed(2)} ↓${p.lower_is_better.toFixed(2)}${e.group ? ` shared:${e.group}` : ""}`);
    } else if (e?.kind === "ordinal") {
      console.log(`   ✓ ${name} ordinal ${e.order.join(" < ").slice(0, 70)}  p=${e.evidence.comparable.toFixed(2)}`);
    } else {
      console.log(`   · ${name} [${kind}] ${s?.reason ?? "?"}${s?.comparable == null ? "" : ` p=${s.comparable.toFixed(2)}`}`);
    }
  });
}
