/**
 * Scores judgments against fixtures/expectations.json.
 *
 *   node scripts/eval.ts                      # Jev, records new answers
 *   node scripts/eval.ts --provider clef      # Clef (needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)
 *   node scripts/eval.ts --offline            # replay recordings only; fails on a miss
 *   node scripts/eval.ts --only edge-cases --verbose
 *   node scripts/eval.ts --offline --strict   # CI gate: fails on undocumented mismatches
 *
 * Answers are recorded in fixtures/recordings/, keyed by the SHA-256 of the
 * request body. A rerun with unchanged questions makes no API calls and gives
 * the same result.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Effect } from "effect";
import type { PageJudgment, PageSnapshot } from "../src/core/types.ts";
import { judgePage } from "../src/decide/judge.ts";
import type { ProviderConfig } from "../src/decide/model.ts";
import { recordedJev } from "./lib/cache.ts";
import { describeEncoding, scorePage, type Check, type CheckKind, type PageExpect } from "./lib/score.ts";

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "jev" },
    offline: { type: "boolean", default: false },
    only: { type: "string" },
    verbose: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
  },
});

const config = (): ProviderConfig => {
  if (args.provider === "jev") return { provider: "jev", apiKey: process.env["TYPESAFE_API_KEY"] ?? "" };
  return {
    provider: "clef",
    accountId: process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "",
    apiToken: process.env["CLOUDFLARE_API_TOKEN"] ?? "",
    model: args.provider === "clef-flash" ? "clef-flash" : "clef",
  };
};

/** Counts requests with no recording. The judge recovers from a failed table or share request, so a miss alone does not fail the run. */
let unrecorded = 0;
if (args.offline) {
  // The model client does not retry a 401, so a miss fails at once.
  globalThis.fetch = async () => {
    unrecorded++;
    return new Response("offline: no recording for this request", { status: 401 });
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const checks: Check[] = [];
const tallyOf = (kind: CheckKind): [number, number] => {
  const of = checks.filter((c) => c.kind === kind);
  return [of.filter((c) => c.ok).length, of.length];
};
const failures = (keep: (c: Check) => boolean) => checks.filter((c) => !c.ok && keep(c)).map((c) => c.message!);

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
  checks.push(...scorePage(slug, judgment, expectations[slug]!));
  const colored = judgment.tables.reduce((n, t) => n + t.encodings.length, 0);
  console.log(`${slug.padEnd(36)} ${String(colored).padStart(3)} columns  ${Math.round(performance.now() - t0)} ms`);
  if (args.verbose) {
    for (const t of judgment.tables) {
      for (const e of t.encodings)
        console.log(`    ${t.id} ${e.header.padEnd(28)} ${describeEncoding(e)}${e.group ? `  ⇄ ${e.group}` : ""}`);
    }
  }
}

await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/eval-${args.provider}.json`, JSON.stringify(out, null, 1));

const pct = ([a, b]: [number, number]) =>
  b === 0 ? "  n/a" : `${((100 * a) / b).toFixed(0).padStart(4)}%  (${a}/${b})`;
console.log(`
model ${args.provider}${args.offline ? " (offline replay)" : ""} · ${requests} requests · ${tokens.toLocaleString()} input tokens · ${Math.round(performance.now() - started)} ms
  color / don't color  ${pct(tallyOf("detect"))}
  polarity             ${pct(tallyOf("polarity"))}
  log vs linear        ${pct(tallyOf("transform"))}
  ordinal order        ${pct(tallyOf("order"))}
  aggregate rows       ${pct(tallyOf("aggregates"))}
  shared scales        ${pct(tallyOf("shared"))}
  rows vs columns      ${pct(tallyOf("orientation"))}`);
const list = (title: string, xs: string[]) =>
  xs.length > 0 && console.log(`\n${title}\n${xs.map((x) => `  - ${x}`).join("\n")}`);
const falsePositive = failures((c) => c.kind === "detect" && c.side === "colored");
const falseNegative = failures((c) => c.kind === "detect" && c.side === "missed");
const misses = failures((c) => c.kind !== "detect");
list("Colored but shouldn't be:", falsePositive);
list("Missed:", falseNegative);
list("Wrong details:", misses);

// With --strict, any mismatch that expectations.$known does not list fails the run.
const known = Object.keys((expectations["$known"] ?? {}) as Record<string, unknown>);
const unexpected = [...falsePositive, ...falseNegative, ...misses].filter((m) => !known.some((k) => m.startsWith(k)));
if (args.strict && unexpected.length > 0) {
  console.log(`\n${unexpected.length} unexpected mismatch(es); see above.`);
  process.exitCode = 1;
}
// Offline, a request with no recording is a failure even when no labeled column depends on it.
if (unrecorded > 0) {
  console.log(`\n${unrecorded} request(s) had no recording; rerun online to record them.`);
  process.exitCode = 1;
}
