/** Probe: does sibling context (other headers, row names) change the ordinal relation call? */
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { profileTable, type CategoricalProfile } from "../../src/core/profile.ts";
import type { PageSnapshot } from "../../src/core/types.ts";
import { categoricalQuestions, categoricalState } from "../../src/decide/questions.ts";
import { jev } from "../../src/decide/model.ts";

const cases: [string, string, string][] = [
  ["readme-cards", "t1", "Category"],
  ["github-copilot-pricing", "t0", "Category"],
  ["readme-cards", "t4", "Priority"],
  ["github-copilot-pricing", "t0", "Tier"],
  ["edge-cases", "t3", "Status"],
  ["edge-cases", "t9", "Region"],
  ["bbref-tarik-skubal", "t1", "Team"],
  ["mtggoldfish-modern-price-index", "t1", "Rarity"],
];
const model = jev(process.env["TYPESAFE_API_KEY"]!);
for (const [slug, id, header] of cases) {
  const page = JSON.parse(await readFile(`fixtures/snapshots/${slug}.json`, "utf8")) as PageSnapshot;
  const table = page.tables.find((t) => t.id === id)!;
  const p = profileTable(table).find((c) => c.header === header) as CategoricalProfile;
  const base = categoricalState({ page: page.title, table: table.title }, p, []);
  const variants = {
    base,
    siblings: { ...base, other_columns: table.headers.filter((h) => h !== header) },
    siblings_rows: { ...base, other_columns: table.headers.filter((h) => h !== header), rows_are: table.rows.slice(0, 4).map((r) => r[0]) },
  };
  const out: string[] = [];
  for (const [name, state] of Object.entries(variants)) {
    const r = await Effect.runPromise(model.evaluate({ state, questions: categoricalQuestions(p).questions }));
    const a = r.answers[`c${p.col}.relation`];
    out.push(`${name}=${a?.type === "choice" ? (a.probabilities["ordered_levels"] ?? 0).toFixed(2) : "?"}`);
  }
  console.log(`${slug.slice(0, 22).padEnd(22)} ${header.padEnd(10)} ${out.join("  ")}`);
}
