/**
 * Prints the raw answers behind one categorical column's judgment.
 *   node scripts/probes/explain.ts <slug> <tableId> <header>
 */
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { profileTable } from "../../src/core/profile.ts";
import type { PageSnapshot } from "../../src/core/types.ts";
import { categoricalQuestions, categoricalState } from "../../src/decide/questions.ts";
import { jev } from "../../src/decide/model.ts";

const [slug, tableId, header] = process.argv.slice(2) as [string, string, string];
const page = JSON.parse(await readFile(`fixtures/snapshots/${slug}.json`, "utf8")) as PageSnapshot;
const table = page.tables.find((t) => t.id === tableId)!;
const p = profileTable(table).find((c) => c.header === header);
if (p?.kind !== "categorical") throw new Error(`${header} is ${p?.kind}`);
const state = categoricalState({ page: page.title, table: table.title }, p, table.headers.filter((h) => h !== header && h !== ""));
console.log(JSON.stringify(state));
const r = await Effect.runPromise(jev(process.env["TYPESAFE_API_KEY"]!).evaluate({ state, questions: categoricalQuestions(p).questions }));
for (const [id, a] of Object.entries(r.answers)) {
  console.log(id.padEnd(16), a.type === "choice" ? JSON.stringify(a.probabilities) : JSON.stringify(a));
}
