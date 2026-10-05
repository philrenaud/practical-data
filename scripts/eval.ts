/**
 * Scores judgments against fixtures/expectations.json.
 *
 *   node scripts/eval.ts                      # Jev, records new answers
 *   node scripts/eval.ts --provider clef      # Clef (needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)
 *   node scripts/eval.ts --offline            # replay recordings only; fails on a miss
 *   node scripts/eval.ts --only edge-cases --verbose
 *   node scripts/eval.ts --offline --strict   # CI gate: fails on undocumented mismatches
 *
 * Answers are cached in fixtures/recordings/ keyed by request hash, so a rerun
 * with unchanged questions costs nothing and is deterministic.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Effect } from "effect";
import type { ColumnEncoding, PageJudgment, PageSnapshot, Polarity } from "../src/core/types.ts";
import { judgePage } from "../src/decide/judge.ts";
import type { ProviderConfig } from "../src/decide/model.ts";
import { recordedJev } from "./lib/cache.ts";

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "jev" },
    offline: { type: "boolean", default: false },
    only: { type: "string" },
    verbose: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
  },
});

type Spec =
  | "none"
  | { kind: ColumnEncoding["kind"]; polarity?: Polarity[]; transform?: "linear" | "log"; order?: string[] };
type TableExpect = Record<string, Spec> & { aggregateRows?: number[] };
type PageExpect = Record<string, TableExpect> & { shared?: string[][] };

const config = (): ProviderConfig => {
  if (args.provider === "jev") return { provider: "jev", apiKey: process.env["TYPESAFE_API_KEY"] ?? "" };
  return {
    provider: "clef",
    accountId: process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "",
    apiToken: process.env["CLOUDFLARE_API_TOKEN"] ?? "",
    model: args.provider === "clef-flash" ? "clef-flash" : "clef",
  };
};

if (args.offline) {
  // A 401 is not retried, so a cache miss fails immediately and loudly.
  globalThis.fetch = async () => new Response("offline: no recording for this request", { status: 401 });
}

// ── Scoring ─────────────────────────────────────────────────────────────────

interface Tally {
  detect: [number, number];
  falsePositive: string[];
  falseNegative: string[];
  polarity: [number, number];
  transform: [number, number];
  order: [number, number];
  aggregates: [number, number];
  shared: [number, number];
  orientation: [number, number];
  misses: string[];
}

const tally: Tally = {
  detect: [0, 0],
  falsePositive: [],
  falseNegative: [],
  polarity: [0, 0],
  transform: [0, 0],
  order: [0, 0],
  aggregates: [0, 0],
  shared: [0, 0],
  orientation: [0, 0],
  misses: [],
};

const score = (bucket: [number, number], ok: boolean) => {
  bucket[0] += ok ? 1 : 0;
  bucket[1] += 1;
  return ok;
};

const describe = (e: ColumnEncoding | undefined) =>
  e === undefined
    ? "none"
    : e.kind === "quantitative"
      ? `${e.polarity}/${e.transform}`
      : `ordinal[${e.order.join(" < ")}]`;

const scorePage = (slug: string, judgment: PageJudgment, expect: PageExpect) => {
  const byKey = new Map<string, ColumnEncoding>();
  for (const t of judgment.tables) for (const e of t.encodings) byKey.set(`${t.id}:${e.header}`, e);

  for (const [tableId, columns] of Object.entries(expect)) {
    if (tableId === "shared" || tableId === "$comment") continue;
    const table = judgment.tables.find((t) => t.id === tableId);
    for (const [header, spec] of Object.entries(columns as TableExpect)) {
      if (Array.isArray(spec)) continue; // aggregateRows
      if (header === "@orientation") {
        const want = spec as unknown as string;
        const got = table?.orientation ?? "columns";
        if (!score(tally.orientation, got === want)) {
          tally.misses.push(`${slug} ${tableId} orientation ${got} (want ${want}) P(rows)=${table?.rowsScore?.toFixed(2) ?? "n/a"}`);
        }
        continue;
      }
      const where = `${slug} ${tableId} "${header}"`;
      const actual = byKey.get(`${tableId}:${header}`);
      const reason = table?.skipped.find((s) => s.header === header);
      const why = reason === undefined ? "" : ` (skipped: ${reason.reason}${reason.comparable === null ? "" : ` p=${reason.comparable.toFixed(2)}`})`;
      if (spec === "none") {
        if (!score(tally.detect, actual === undefined)) tally.falsePositive.push(`${where} → ${describe(actual)}`);
        continue;
      }
      if (!score(tally.detect, actual?.kind === spec.kind)) {
        tally.falseNegative.push(`${where} expected ${spec.kind} → ${describe(actual)}${why}`);
        continue;
      }
      if (spec.polarity !== undefined && actual !== undefined) {
        const ok = score(tally.polarity, spec.polarity.includes(actual.polarity));
        if (!ok) {
          const p = actual.evidence.polarity;
          tally.misses.push(
            `${where} polarity ${actual.polarity} (want ${spec.polarity.join("|")}) ↑${p.higher_is_better.toFixed(2)} ↓${p.lower_is_better.toFixed(2)} ·${p.neutral.toFixed(2)}`,
          );
        }
      }
      if (spec.transform !== undefined && actual?.kind === "quantitative") {
        if (!score(tally.transform, actual.transform === spec.transform)) {
          tally.misses.push(`${where} transform ${actual.transform} (want ${spec.transform}) p(log)=${actual.evidence.log?.toFixed(2)}`);
        }
      }
      if (spec.order !== undefined && actual?.kind === "ordinal") {
        if (!score(tally.order, actual.order.join("|") === spec.order.join("|"))) {
          tally.misses.push(`${where} order ${actual.order.join(" < ")}`);
        }
      }
    }
    const wantAgg = (columns as TableExpect).aggregateRows;
    if (wantAgg !== undefined) {
      const got = table?.aggregateRows ?? [];
      if (!score(tally.aggregates, JSON.stringify([...got].sort()) === JSON.stringify(wantAgg))) {
        tally.misses.push(`${slug} ${tableId} aggregate rows ${JSON.stringify(got)} (want ${JSON.stringify(wantAgg)})`);
      }
    }
  }
  for (const group of expect.shared ?? []) {
    const groups = group.map((k) => byKey.get(k)?.group ?? null);
    const ok = groups[0] !== null && groups.every((g) => g === groups[0]);
    if (!score(tally.shared, ok)) tally.misses.push(`${slug} not shared: ${group.join(" + ")} → ${JSON.stringify(groups)}`);
  }
};

// ── Run ─────────────────────────────────────────────────────────────────────

const expectations = JSON.parse(await readFile("fixtures/expectations.json", "utf8")) as Record<string, PageExpect>;
const slugs = (await readdir("fixtures/snapshots"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((s) => !s.startsWith("$") && s in expectations && (args.only === undefined || s === args.only));

const layer = recordedJev(config());
const out: Record<string, PageJudgment> = {};
let tokens = 0;
let requests = 0;
const started = performance.now();

for (const slug of slugs) {
  const page = JSON.parse(await readFile(`fixtures/snapshots/${slug}.json`, "utf8")) as PageSnapshot;
  const t0 = performance.now();
  const judgment = await Effect.runPromise(judgePage(page).pipe(Effect.provide(layer)));
  out[slug] = judgment;
  tokens += judgment.usage.inputTokens;
  requests += judgment.usage.requests;
  scorePage(slug, judgment, expectations[slug]!);
  const colored = judgment.tables.reduce((n, t) => n + t.encodings.length, 0);
  console.log(`${slug.padEnd(36)} ${String(colored).padStart(3)} columns  ${Math.round(performance.now() - t0)} ms`);
  if (args.verbose) {
    for (const t of judgment.tables) {
      for (const e of t.encodings) console.log(`    ${t.id} ${e.header.padEnd(28)} ${describe(e)}${e.group ? `  ⇄ ${e.group}` : ""}`);
    }
  }
}

await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/eval-${args.provider}.json`, JSON.stringify(out, null, 1));

const pct = ([a, b]: [number, number]) => (b === 0 ? "  n/a" : `${((100 * a) / b).toFixed(0).padStart(4)}%  (${a}/${b})`);
console.log(`
model ${args.provider}${args.offline ? " (offline replay)" : ""} · ${requests} requests · ${tokens.toLocaleString()} input tokens · ${Math.round(performance.now() - started)} ms
  color / don't color  ${pct(tally.detect)}
  polarity             ${pct(tally.polarity)}
  log vs linear        ${pct(tally.transform)}
  ordinal order        ${pct(tally.order)}
  aggregate rows       ${pct(tally.aggregates)}
  shared scales        ${pct(tally.shared)}
  rows vs columns      ${pct(tally.orientation)}`);
const list = (title: string, xs: string[]) => xs.length > 0 && console.log(`\n${title}\n${xs.map((x) => `  - ${x}`).join("\n")}`);
list("Colored but shouldn't be:", tally.falsePositive);
list("Missed:", tally.falseNegative);
list("Wrong details:", tally.misses);

// --strict: fail on any regression not documented in expectations.$known.
const known = Object.keys((expectations["$known"] ?? {}) as Record<string, unknown>);
const unexpected = [...tally.falsePositive, ...tally.falseNegative, ...tally.misses].filter(
  (m) => !known.some((k) => m.startsWith(k)),
);
if (args.strict && unexpected.length > 0) {
  console.log(`\n${unexpected.length} unexpected mismatch(es); see above.`);
  process.exitCode = 1;
}
