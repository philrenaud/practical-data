/** Probe: does adding per-label row counts or sibling headers to state improve pairwise order? */
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { profileTable, type CategoricalProfile } from "../../src/core/profile.ts";
import { orderFromPairs } from "../../src/core/order.ts";
import type { PageSnapshot } from "../../src/core/types.ts";
import { categoricalQuestions, categoricalState } from "../../src/decide/questions.ts";
import { jev } from "../../src/decide/model.ts";

const cases: [string, string, string][] = [
  ["scryfall-blb-checklist", "t0", "R"],
  ["mtggoldfish-modern-price-index", "t1", "Rarity"],
  ["wiki-costliest-atlantic-hurricanes", "t1", "Storm classification at peak intensity"],
  ["edge-cases", "t0", "Size"],
  ["edge-cases", "t3", "Priority"],
  ["edge-cases", "t9", "Sweetness"],
  ["edge-cases", "t9", "Body"],
  ["dark-theme", "t0", "Tier"],
  ["github-copilot-pricing", "t0", "Category"],
];
const model = jev(process.env["TYPESAFE_API_KEY"]!);

for (const [slug, tableId, header] of cases) {
  const page = JSON.parse(await readFile(`fixtures/snapshots/${slug}.json`, "utf8")) as PageSnapshot;
  const table = page.tables.find((t) => t.id === tableId)!;
  const p = profileTable(table).find((c) => c.header === header) as CategoricalProfile;
  const base = categoricalState({ page: page.title, table: table.title }, p, []);
  const counts = p.levels.map((l) => p.values.filter((v) => v === l).length);
  const variants: Record<string, unknown> = {
    base,
    counts: { ...base, column: { ...base.column, rows_per_value: Object.fromEntries(p.levels.map((l, i) => [p.display[l], counts[i]])) } },
    headers: { ...base, other_columns: table.headers.filter((h) => h !== header && h !== "") },
  };
  const out: string[] = [];
  for (const [name, state] of Object.entries(variants)) {
    const q = categoricalQuestions(p);
    const r = await Effect.runPromise(model.evaluate({ state, questions: q.questions }));
    const { order, confidence } = orderFromPairs(p.levels, q.read(r.answers).lower);
    out.push(`${name}: ${order.join("<")} (${confidence.toFixed(2)})`);
  }
  console.log(`${header.slice(0, 14).padEnd(14)} ${out.join("   ")}`);
}
