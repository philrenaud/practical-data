/**
 * Builds the tests site's data in demo/tests/ (git-ignored): every eval check,
 * a per-column trace of each test page, and the unit tests as run. Everything
 * comes from an offline replay of fixtures/recordings, so it is exactly what
 * `npm run eval -- --offline` and `npm test` see.
 *
 *   demo/tests/index.json           totals, checks, pages, unit tests, parsing examples
 *   demo/tests/pages/<slug>.json    tables, judgments, profiles and checks
 *   demo/tests/requests/<slug>.json each table's requests and answers, fetched on demand by the site
 *
 *   node scripts/tests-data.ts
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { isDateLike, isMissing, parseNumber } from "../src/core/parse.ts";
import { describeSpread, profileTable, type ColumnProfile } from "../src/core/profile.ts";
import type { PageJudgment, PageSnapshot, TableSnapshot } from "../src/core/types.ts";
import { DEFAULT_POLICY, judgePage, MAX_TRANSPOSE_ROWS } from "../src/decide/judge.ts";
import { DecisionModel, jev, type DecisionRequest, type DecisionResponse } from "../src/decide/model.ts";
import { fileCache } from "./lib/cache.ts";
import { knownReason, scorePage, type Check, type PageExpect } from "./lib/score.ts";

const OUT = "demo/tests";

// A miss fails the build instead of calling the model: the site shows recorded answers only.
// The judge absorbs a failed table or share request, so misses are counted here.
let unrecorded = 0;
globalThis.fetch = async () => {
  unrecorded++;
  return new Response("offline: no recording for this request", { status: 401 });
};

/** One request the judge sent, with the answers it got. */
export interface Exchange {
  readonly state: unknown;
  readonly questions: DecisionRequest["questions"];
  readonly answers: DecisionResponse["answers"];
  readonly inputTokens: number;
}

/** Runs `page` against the recordings, keeping every request and answer. */
const judgeRecorded = async (page: PageSnapshot) => {
  const exchanges: Exchange[] = [];
  const recorded = jev("");
  const capture = Layer.succeed(DecisionModel, {
    name: recorded.name,
    evaluate: (req) =>
      recorded.evaluate(req).pipe(
        Effect.tap((res) =>
          Effect.sync(() =>
            exchanges.push({ state: req.state, questions: req.questions, answers: res.answers, inputTokens: res.usage.input_tokens }),
          ),
        ),
      ),
  });
  const judgment = await Effect.runPromise(judgePage(page).pipe(Effect.provide(Layer.merge(capture, fileCache()))));
  return { judgment, exchanges };
};

const sources = new Map(
  (JSON.parse(await readFile("fixtures/live/sources.json", "utf8")) as { slug: string; url: string; title: string; notes?: string }[]).map((s) => [s.slug, s]),
);
/** Short, distinct names for navigation (page titles run long, and two pages share one). */
const NAMES: Readonly<Record<string, string>> = {
  "bbref-aaron-judge": "Aaron Judge: batting",
  "bbref-rules-changes": "MLB rules changes",
  "bbref-tarik-skubal": "Tarik Skubal: pitching",
  "cloudflare-clef": "Clef benchmarks",
  collapsed: "Collapsed tables",
  "dark-theme": "Dark theme",
  "edge-cases": "Edge cases",
  "github-copilot-pricing": "GitHub Copilot pricing",
  lifecycle: "Lifecycle",
  "mtggoldfish-modern-price-index": "MTGGoldfish price index",
  ranges: "Ranges and records",
  "readme-cards": "README cards",
  "scryfall-blb-checklist": "Scryfall checklist",
  "statcan-urban-greenness": "StatCan urban greenness",
  "wiki-costliest-atlantic-hurricanes": "Costliest hurricanes",
  "wiki-countries-by-population": "Countries by population",
  "wiki-mlb-career-era-leaders": "MLB career ERA leaders",
  "wiki-mtg-sets": "Magic: The Gathering sets",
  "wiki-super-bowl-champions": "Super Bowl champions",
  "wiki-tallest-buildings": "Tallest buildings",
};

/** What each synthetic page is for; live pages carry notes in fixtures/live/sources.json. */
const SYNTHETIC: Readonly<Record<string, string>> = {
  "edge-cases":
    "Columns that look numeric but aren't amounts (SKUs, jersey numbers, zip codes, birth years), ordered labels (sizes, priorities, sweetness), a free-text glossary, two stores' prices that should share a scale, and signed changes with no better direction.",
  ranges:
    "Values written as ranges and records: age brackets (20-25, 65+), placed on the scale by their midpoints, and win-loss records (12-4) and game scores (35-10), which are two counts and must not be read as one amount.",
  "dark-theme": "A dark page: shading picks the dark ramps and keeps text contrast from the page's own colors.",
  lifecycle: "Tables that change after load: cells edited in place, tables inserted later, page styles changing, and client-side navigation.",
  collapsed: "Like Wikipedia's [show] tables: the header row is visible and the body hidden until expanded.",
  "opted-out": "A page that opts out with <meta name=\"practical-data\" content=\"off\">: nothing is judged or painted.",
  "readme-cards": "The pricing tables behind the README images.",
};
const notice = await readFile("fixtures/NOTICE.md", "utf8");
/** Attribution per live fixture, from the NOTICE table: | `slug` | [title](url) | rights |. */
const rights = new Map(
  [...notice.matchAll(/^\| `([^`]+)` \| \[([^\]]+)\]\(([^)]+)\) \| ([^|]+) \|$/gm)].map((m) => [m[1]!, { title: m[2]!, url: m[3]!, rights: m[4]!.trim() }]),
);

const expectations = JSON.parse(await readFile("fixtures/expectations.json", "utf8")) as Record<string, PageExpect> & {
  $known?: Record<string, string>;
};
const known = expectations.$known ?? {};
const slugs = (await readdir("fixtures/snapshots")).map((f) => f.replace(/\.json$/, "")).filter((s) => s in expectations).sort();

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/pages`, { recursive: true });
await mkdir(`${OUT}/requests`, { recursive: true });

const checks: (Check & { known: string | null })[] = [];
const pages = [];
const samples: Record<string, { id: string; question: unknown; answer: unknown; page: string }> = {};
let requests = 0;
let inputTokens = 0;
let model = "";

/** The column profile as plain facts, without the parser's internals. */
const profileFacts = (p: ColumnProfile) =>
  p.kind === "numeric"
    ? { kind: p.kind, col: p.col, header: p.header, unit: p.unit, samples: p.samples, spread: describeSpread(p) }
    : p.kind === "categorical"
      ? { kind: p.kind, col: p.col, header: p.header, levels: p.levels.map((l) => p.display[l] ?? l) }
      : { kind: p.kind, col: p.col, header: p.header, reason: p.reason };

for (const slug of slugs) {
  const page = JSON.parse(await readFile(`fixtures/snapshots/${slug}.json`, "utf8")) as PageSnapshot;
  const full = await judgeRecorded(page);
  requests += full.judgment.usage.requests;
  model ||= full.judgment.model;
  inputTokens += full.judgment.usage.inputTokens;
  const pageChecks = scorePage(slug, full.judgment, expectations[slug]!).map((c) => ({ ...c, known: knownReason(c, known) }));
  checks.push(...pageChecks);

  // Each table alone, for its own trace: its requests are the same ones the full page sent
  // (state names the page and table, never other tables), so they replay from the recordings.
  const tables = [];
  for (const t of page.tables) {
    const judgment = full.judgment.tables.find((x) => x.id === t.id);
    if (judgment === undefined) continue;
    const alone = await judgeRecorded({ ...page, tables: [t] });
    for (const x of alone.exchanges) {
      for (const [id, question] of Object.entries(x.questions)) {
        const kind = id.replace(/\d+/g, "#");
        samples[kind] ??= { id, question, answer: x.answers[id], page: slug };
      }
    }
    tables.push({
      snapshot: t satisfies TableSnapshot,
      profiles: profileTable(t).map(profileFacts),
      expected: (expectations[slug] as Record<string, unknown>)[t.id] ?? null,
      exchanges: alone.exchanges,
      requests: {
        count: alone.exchanges.length,
        questions: alone.exchanges.reduce((n, x) => n + Object.keys(x.questions).length, 0),
        inputTokens: alone.exchanges.reduce((n, x) => n + x.inputTokens, 0),
      },
    });
  }
  // The page-level request: do same-named columns across tables share a scale?
  const shared = full.exchanges.filter((x) => Object.keys(x.questions).some((id) => id.endsWith(".share")));
  for (const x of shared) {
    for (const [id, question] of Object.entries(x.questions)) samples[id.replace(/\d+/g, "#")] ??= { id, question, answer: x.answers[id], page: slug };
  }
  const live = sources.get(slug);
  const attribution = rights.get(slug);
  const summary = {
    slug,
    name: NAMES[slug] ?? page.title,
    title: page.title,
    origin: live === undefined ? "synthetic" : "live",
    source: live === undefined ? null : { title: attribution?.title ?? live.title, url: live.url, rights: attribution?.rights ?? "" },
    notes: live?.notes ?? SYNTHETIC[slug] ?? null,
    tables: tables.length,
    columns: full.judgment.tables.reduce((n, t) => n + t.encodings.length, 0),
    score: [pageChecks.filter((c) => c.ok).length, pageChecks.length] as const,
    known: pageChecks.filter((c) => !c.ok && c.known !== null).length,
    requests: full.judgment.usage.requests,
    inputTokens: full.judgment.usage.inputTokens,
  };
  pages.push(summary);
  // Requests and answers are most of the bytes; the site fetches them only when a reader opens them.
  await writeFile(
    `${OUT}/pages/${slug}.json`,
    JSON.stringify({ ...summary, judgment: full.judgment satisfies PageJudgment, tables: tables.map(({ exchanges: _, ...t }) => t), shared, checks: pageChecks }),
  );
  await writeFile(`${OUT}/requests/${slug}.json`, JSON.stringify(Object.fromEntries(tables.map((t) => [t.snapshot.id, t.exchanges]))));
  if (unrecorded > 0) throw new Error(`${slug}: ${unrecorded} request(s) have no recording; run \`npm run eval\` online to record them.`);
  console.log(`${slug.padEnd(36)} ${summary.score[0]}/${summary.score[1]} checks  ${tables.length} tables`);
}

// ── Unit tests, as run ──────────────────────────────────────────────────────

const units = [];
for (const file of (await readdir("test")).filter((f) => f.endsWith(".test.ts")).sort()) {
  let tap: string;
  try {
    tap = execFileSync("node", ["--test", "--test-reporter=tap", `test/${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    tap = (e as { stdout?: string }).stdout ?? "";
  }
  // Top-level tests only (the suite has no describe blocks); a TAP "#" in a name is escaped as "\#".
  const tests = [...tap.matchAll(/^(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO)\b.*)?\n {2}---\n {2}duration_ms: ([\d.]+)/gm)].map((m) => ({
    name: m[2]!.replaceAll("\\#", "#"),
    ok: m[1] === "ok" && m[3] === undefined,
    skipped: m[3] !== undefined,
    ms: Number(m[4]),
  }));
  if (tests.length === 0) throw new Error(`test/${file}: no test results (did it crash?)`);
  units.push({ file, tests });
}

// ── Parsing, live ───────────────────────────────────────────────────────────

const PARSE_EXAMPLES = [
  "$0.025", "€1,200.50", "($3.00)", "-$3", "45%", ".312", "1.5B", "272K", "6' 6\"", "2:59", "20–25", "65+",
  "≤ 272K", "> 200K", "12-4", "35-10", "1,066", "3.2 GB", "829.8 m", "2,722 ft", "N/A", "—", "2023-01-01", "July 17, 2009",
];
const parsing = PARSE_EXAMPLES.map((input) => ({
  input,
  missing: isMissing(input),
  date: isDateLike(input),
  parsed: parseNumber(input),
}));

const kinds = ["detect", "polarity", "transform", "order", "aggregates", "shared", "orientation"] as const;
const totals = Object.fromEntries(
  kinds.map((k) => {
    const of = checks.filter((c) => c.kind === k);
    return [k, { ok: of.filter((c) => c.ok).length, total: of.length, known: of.filter((c) => !c.ok && c.known !== null).length }];
  }),
);

await writeFile(
  `${OUT}/index.json`,
  JSON.stringify({ model, requests, inputTokens, policy: DEFAULT_POLICY, maxTransposeRows: MAX_TRANSPOSE_ROWS, totals, checks, pages, units, parsing, samples, known }),
);
console.log(
  `\n${checks.filter((c) => c.ok).length}/${checks.length} checks · ${units.reduce((n, u) => n + u.tests.length, 0)} unit tests · ${requests} requests replayed`,
);
