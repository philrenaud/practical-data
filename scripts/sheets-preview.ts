/**
 * Shows what the Sheets add-on would do to real tables, without Sheets: each
 * fixture table is judged offline from recordings, planned into formatting
 * by src/sheets/plan.ts, and drawn as a sheet with that formatting applied
 * the way Sheets applies it. Writes artifacts/sheets-preview.html and .png.
 *
 * Cells that read as plain amounts ("$1,200", "45%", "3.2") become numbers,
 * as they would typed into a sheet; anything else ("1,200 GB") stays text.
 *
 *   node scripts/sheets-preview.ts [slug:table-index ...]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { interpolateRgb } from "d3-interpolate";
import { chromium } from "playwright";
import { parseNumber } from "../src/core/parse.ts";
import { DEFAULT_PALETTE } from "../src/core/palettes.ts";
import type { PageSnapshot } from "../src/core/types.ts";
import { judgePage } from "../src/decide/judge.ts";
import { DecisionModel, jev } from "../src/decide/model.ts";
import { planFormatting, requestFromRange, type Formatting } from "../src/sheets/plan.ts";
import { fileCache } from "./lib/cache.ts";

const picks = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["github-copilot-pricing:0", "wiki-tallest-buildings:1", "wiki-mtg-sets:0", "cloudflare-clef:0"];
const MAX_ROWS = 14;

const asNumber = (text: string): number | string => {
  const n = parseNumber(text);
  return n !== null && !n.bound && n.range === null && (n.unit === null || ["$", "%", "€", "£"].includes(n.unit)) ? n.value : text;
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The background Sheets would give cell (r, c) of the range: first matching rule, else a direct fill. */
const backgroundOf = (formatting: readonly Formatting[], raw: readonly (readonly unknown[])[], r: number, c: number): string | null => {
  const inBlocks = (blocks: readonly { row: number; col: number; rows: number; cols: number }[]) =>
    blocks.some((b) => r >= b.row && r < b.row + b.rows && c >= b.col && c < b.col + b.cols);
  for (const f of formatting) {
    if (f.kind === "scale" && inBlocks(f.blocks)) {
      const v = raw[r]?.[c];
      if (typeof v !== "number") continue;
      if (v <= f.mid.value) return interpolateRgb(f.min.color, f.mid.color)(Math.max(0, (v - f.min.value) / (f.mid.value - f.min.value || 1)));
      return interpolateRgb(f.mid.color, f.max.color)(Math.min(1, (v - f.mid.value) / (f.max.value - f.mid.value || 1)));
    }
    if (f.kind === "levels" && inBlocks(f.blocks)) {
      const text = String(raw[r]?.[c] ?? "").trim().toLowerCase();
      const level = f.levels.find((l) => l.text.trim().toLowerCase() === text);
      if (level !== undefined) return level.color;
    }
  }
  for (const f of formatting) {
    if (f.kind === "fill") {
      const cell = f.cells.find((x) => x.row === r && x.col === c);
      if (cell !== undefined) return cell.color;
    }
  }
  return null;
};

const sections: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("offline", { status: 401 });
for (const pick of picks) {
  const [slug, index] = pick.split(":") as [string, string | undefined];
  const page = JSON.parse(await readFile(`fixtures/snapshots/${slug}.json`, "utf8")) as PageSnapshot;
  const table = page.tables[Number(index ?? 0)]!;
  const display = [table.headers, ...table.rows].map((r) => [...r]);
  const { request } = requestFromRange(display, page.title, table.title ?? "Sheet1");
  const judged = await Effect.runPromise(
    judgePage({ url: "", title: request.title, tables: [{ id: "t0", ...request.table, title: table.title }] }).pipe(
      Effect.provide(Layer.merge(Layer.succeed(DecisionModel, jev("")), fileCache())),
      Effect.result,
    ),
  );
  if (judged._tag === "Failure" || judged.success.tables[0] === undefined) {
    console.log(`${pick}: not judged offline (${judged._tag === "Failure" ? judged.failure.message.slice(0, 120) : "no table"})`);
    continue;
  }
  const judgment = judged.success.tables[0];
  const raw = display.map((row, r) => (r === 0 ? row : row.map(asNumber)));
  const formatting = planFormatting(judgment, raw, DEFAULT_PALETTE);
  const shown = display.slice(0, MAX_ROWS + 1);
  const letter = (c: number) => String.fromCharCode(65 + c);
  const rows = shown
    .map((row, r) => {
      const cells = row
        .map((text, c) => {
          const bg = r === 0 ? null : backgroundOf(formatting, raw, r, c);
          const numeric = typeof raw[r]?.[c] === "number";
          return `<td class="${r === 0 ? "h" : ""}${numeric ? " n" : ""}"${bg === null ? "" : ` style="background:${bg}"`}>${escape(text)}</td>`;
        })
        .join("");
      return `<tr><th>${r + 1}</th>${cells}</tr>`;
    })
    .join("\n");
  const summary = formatting
    .map((f) => `<li><b>${escape(f.header)}</b>: ${f.kind === "scale" ? `color scale ${f.min.value} → ${f.max.value}` : f.kind === "levels" ? `${f.levels.length} level rules` : `${f.cells.length} cells filled (numbers stored as text)`}</li>`)
    .join("");
  sections.push(`<section><h2>${escape(page.title)} · ${escape(table.title ?? "")}</h2>
<ul>${summary}</ul>
<div class="grid"><table><tr><th></th>${shown[0]!.map((_, c) => `<th>${letter(c)}</th>`).join("")}</tr>
${rows}</table></div>${display.length > shown.length ? `<p class="more">+${display.length - shown.length} more rows</p>` : ""}</section>`);
  console.log(`${pick}: ${formatting.map((f) => `${f.header} (${f.kind})`).join(", ")}`);
}
globalThis.fetch = realFetch;

const html = `<!doctype html><meta charset="utf-8"><title>Sheets preview</title>
<style>
body { font: 13px Arial, sans-serif; margin: 24px; background: #f8f9fa; color: #202124; }
h2 { font-size: 15px; margin: 28px 0 6px; }
ul { margin: 0 0 10px; padding-left: 18px; color: #5f6368; }
.grid { overflow-x: auto; background: #fff; border: 1px solid #dadce0; display: inline-block; max-width: 100%; }
table { border-collapse: collapse; font-size: 13px; }
td, th { border: 1px solid #e2e3e3; padding: 3px 6px; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
th { background: #f8f9fa; color: #5f6368; font-weight: normal; text-align: center; min-width: 28px; }
td.h { font-weight: bold; }
td.n { text-align: right; }
.more { color: #5f6368; margin: 4px 0 0; }
</style>
<h1 style="font-size:18px">Practical Data for Sheets: preview</h1>
${sections.join("\n")}`;
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/sheets-preview.html", html);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await tab.setContent(html);
await tab.screenshot({ path: "artifacts/sheets-preview.png", fullPage: true });
await browser.close();
console.log("wrote artifacts/sheets-preview.html and .png");
