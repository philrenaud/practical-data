/**
 * Builds the data for the tests site in demo/tests/, which is not committed.
 * The data holds every eval check, the tables that the checks run on, and the
 * unit test results. It replays fixtures/recordings offline, so it matches
 * `npm run eval -- --offline` and `npm test`.
 *
 *   demo/tests/index.json           totals, checks, pages, unit tests, parsing examples
 *   demo/tests/pages/<slug>.json    tables, judgments and checks
 *   demo/tests/requests/<slug>.json each table's requests and answers, fetched on demand by the site
 *
 *   node scripts/tests-data.ts
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { formatDate, parseDate, type DatePrecision, type DateUnit } from "../src/core/dates.ts";
import { isDateLike, isMissing, parseNumber } from "../src/core/parse.ts";
import type { PageJudgment, PageSnapshot, TableJudgment, TableSnapshot } from "../src/core/types.ts";
import { DEFAULT_POLICY, judgePage, MAX_TRANSPOSE_ROWS } from "../src/decide/judge.ts";
import { jev, type DecisionModel, type DecisionRequest, type DecisionResponse } from "../src/decide/model.ts";
import { fileCache } from "./lib/cache.ts";
import { knownReason, scorePage, type Check, type PageExpect } from "./lib/score.ts";

const OUT = "demo/tests";

// The site shows recorded answers only, so a missing recording fails the build instead of calling the model.
// The judge recovers from a failed table or share request, so count the misses here.
let unrecorded = 0;
globalThis.fetch = async () => {
  unrecorded++;
  return new Response("offline: no recording for this request", { status: 401 });
};

/** One request the judge sent, with the answers it got. */
interface Exchange {
  readonly state: unknown;
  readonly questions: DecisionRequest["questions"];
  readonly answers: DecisionResponse["answers"];
  readonly inputTokens: number;
}

/** Judges `page` from the recordings and keeps every request and answer. */
const judgeRecorded = async (page: PageSnapshot) => {
  const exchanges: Exchange[] = [];
  const recorded = jev("", { cache: fileCache() });
  const capture: DecisionModel = {
    name: recorded.name,
    evaluate: async (req, signal) => {
      const res = await recorded.evaluate(req, signal);
      exchanges.push({
        state: req.state,
        questions: req.questions,
        answers: res.answers,
        inputTokens: res.usage.input_tokens,
      });
      return res;
    },
  };
  const judgment = await judgePage(capture, page);
  return { judgment, exchanges };
};

const sources = new Map(
  (
    JSON.parse(await readFile("fixtures/live/sources.json", "utf8")) as { slug: string; url: string; title: string }[]
  ).map((s) => [s.slug, s]),
);
/** Short, distinct names for site navigation. Page titles are long, and two pages share one title. */
const NAMES: Readonly<Record<string, string>> = {
  "bbref-aaron-judge": "Aaron Judge: batting",
  "bbref-rules-changes": "MLB rules changes",
  "bbref-tarik-skubal": "Tarik Skubal: pitching",
  "bkref-thunder-2025": "Thunder: roster and stats",
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
  "wiki-2022-winter-olympics-medal-table": "2022 Winter Olympics medals",
  "wiki-2024-mlb-season": "2024 MLB standings",
  "wiki-costliest-atlantic-hurricanes": "Costliest hurricanes",
  "wiki-countries-by-population": "Countries by population",
  "wiki-demographics-of-japan": "Japan by age",
  "wiki-earthquakes-2023": "Earthquakes of 2023",
  "wiki-mlb-career-era-leaders": "MLB career ERA leaders",
  "wiki-mtg-sets": "Magic: The Gathering sets",
  "wiki-super-bowl-champions": "Super Bowl champions",
  "wiki-tallest-buildings": "Tallest buildings",
};

const notice = await readFile("fixtures/NOTICE.md", "utf8");
/** Attribution for each live fixture, parsed from the table in fixtures/NOTICE.md. */
const rights = new Map(
  [...notice.matchAll(/^\| `([^`]+)` \| \[([^\]]+)\]\(([^)]+)\) \| ([^|]+) \|$/gm)].map((m) => [
    m[1]!,
    { title: m[2]!, url: m[3]!, rights: m[4]!.trim() },
  ]),
);

const expectations = JSON.parse(await readFile("fixtures/expectations.json", "utf8")) as Record<string, PageExpect> & {
  $known?: Record<string, string>;
};
const known = expectations.$known ?? {};
const slugs = (await readdir("fixtures/snapshots"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((s) => s in expectations)
  .sort();

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/pages`, { recursive: true });
await mkdir(`${OUT}/requests`, { recursive: true });

const checks: (Check & { known: string | null })[] = [];
const pages = [];
const samples: Record<
  string,
  { id: string; question: unknown; answer: unknown; state: unknown; page: string; table: string | null }
> = {};
/**
 * Scores how well a question illustrates its kind. The highest-scoring
 * question of each kind becomes the example on the site. A question about a
 * shaded column scores above one about an ignored column. An answer that
 * shows the point of its question, such as lower-is-better, ordered labels, a
 * total, or a log scale, scores above a routine one. Ties keep the first
 * question seen.
 */
const sampleScore = (
  id: string,
  answer: DecisionResponse["answers"][string] | undefined,
  table: TableJudgment | undefined,
): number => {
  const col = Number(/^[nc](\d+)\./.exec(id)?.[1] ?? -1);
  const e = table?.encodings.find((x) => x.col === col);
  const choice = answer?.type === "choice" ? answer.choice : null;
  const yes = answer?.type === "noul" && answer.noul >= 0.5;
  if (/^n\d+\.polarity$/.test(id)) return (e?.kind === "quantitative" ? 2 : 0) + (choice === "lower_is_better" ? 1 : 0);
  if (/^c\d+\.polarity$/.test(id)) return e?.kind === "ordinal" ? 2 : 0;
  if (/^c\d+\.relation$/.test(id)) return (e?.kind === "ordinal" ? 2 : 0) + (choice === "ordered_levels" ? 1 : 0);
  // Identifiers and records, such as jersey numbers and win-loss records, illustrate the role question best.
  // Years and ranks come next.
  if (/^n\d+\.role$/.test(id))
    return choice === "identifier" || choice === "record" ? 2 : choice !== null && choice !== "measure" ? 1 : 0;
  return yes ? 1 : 0;
};
const sampleScores: Record<string, number> = {};
const offerSample = (
  id: string,
  question: unknown,
  x: Exchange,
  page: string,
  table: string | null,
  judgment?: TableJudgment,
  failing: ReadonlySet<string> = new Set(),
  passing: ReadonlySet<string> = new Set(),
  headers: readonly string[] = [],
) => {
  const kind = id.replace(/\d+/g, "#");
  const answer = x.answers[id];
  // A column with a failing check makes a misleading example. The site lists failures separately.
  const header = headers[Number(/^[nc](\d+)\./.exec(id)?.[1] ?? -1)];
  // A passing hand-labeled column is the best example, because a visitor can check the answer against its label.
  const score =
    header !== undefined && failing.has(header)
      ? -1
      : sampleScore(id, answer, judgment) + (header !== undefined && passing.has(header) ? 2 : 0);
  if (samples[kind] === undefined || score > (sampleScores[kind] ?? 0)) {
    samples[kind] = { id, question, answer, state: x.state, page, table };
    sampleScores[kind] = score;
  }
};
let requests = 0;
let inputTokens = 0;
let model = "";

for (const slug of slugs) {
  const page = JSON.parse(await readFile(`fixtures/snapshots/${slug}.json`, "utf8")) as PageSnapshot;
  const full = await judgeRecorded(page);
  requests += full.judgment.usage.requests;
  model ||= full.judgment.model;
  inputTokens += full.judgment.usage.inputTokens;
  const pageChecks = scorePage(slug, full.judgment, expectations[slug]!).map((c) => ({
    ...c,
    known: knownReason(c, known),
  }));
  checks.push(...pageChecks);

  // Judge each table alone to get its own trace. The state names only the page and the table,
  // so these requests match the ones that the full page sent, and they replay from the recordings.
  const tables = [];
  for (const t of page.tables) {
    const judgment = full.judgment.tables.find((x) => x.id === t.id);
    if (judgment === undefined) continue;
    const alone = await judgeRecorded({ ...page, tables: [t] });
    // Take example questions only from hand-labeled tables on live pages.
    const labeled = sources.has(slug) && (expectations[slug] as Record<string, unknown>)[t.id] !== undefined;
    const passingColumns = new Set(
      pageChecks.filter((c) => c.ok && c.table === t.id && c.column !== null).map((c) => c.column!),
    );
    const failingColumns = new Set(
      pageChecks.filter((c) => !c.ok && c.table === t.id && c.column !== null).map((c) => c.column!),
    );
    // Take a totals example only from a table with hand-labeled totals.
    const totalsLabeled =
      ((expectations[slug] as Record<string, { aggregateRows?: unknown }>)[t.id]?.aggregateRows ?? null) !== null;
    for (const x of labeled ? alone.exchanges : []) {
      for (const [id, question] of Object.entries(x.questions))
        if (totalsLabeled || !id.endsWith(".aggregate"))
          offerSample(id, question, x, slug, t.id, judgment, failingColumns, passingColumns, t.headers);
    }
    tables.push({
      snapshot: t satisfies TableSnapshot,
      exchanges: alone.exchanges,
      requests: {
        count: alone.exchanges.length,
        questions: alone.exchanges.reduce((n, x) => n + Object.keys(x.questions).length, 0),
        inputTokens: alone.exchanges.reduce((n, x) => n + x.inputTokens, 0),
      },
    });
  }
  // The page-level request asks whether same-named columns in different tables share a scale.
  const shared = full.exchanges.filter((x) => Object.keys(x.questions).some((id) => id.endsWith(".share")));
  // Shared-scale examples come from pages with hand-labeled shared scales.
  for (const x of sources.has(slug) && expectations[slug]!.shared !== undefined ? shared : []) {
    for (const [id, question] of Object.entries(x.questions)) offerSample(id, question, x, slug, null);
  }
  const live = sources.get(slug);
  const attribution = rights.get(slug);
  const summary = {
    slug,
    name: NAMES[slug] ?? page.title,
    title: page.title,
    origin: live === undefined ? "synthetic" : "live",
    source:
      live === undefined
        ? null
        : { title: attribution?.title ?? live.title, url: live.url, rights: attribution?.rights ?? "" },
    tables: tables.length,
    columns: full.judgment.tables.reduce((n, t) => n + t.encodings.length, 0),
    score: [pageChecks.filter((c) => c.ok).length, pageChecks.length] as const,
    known: pageChecks.filter((c) => !c.ok && c.known !== null).length,
    requests: full.judgment.usage.requests,
    inputTokens: full.judgment.usage.inputTokens,
  };
  pages.push(summary);
  // Requests and answers are most of the data, so they go in a separate file that the site fetches on demand.
  await writeFile(
    `${OUT}/pages/${slug}.json`,
    JSON.stringify({
      ...summary,
      judgment: full.judgment satisfies PageJudgment,
      tables: tables.map(({ exchanges: _, ...t }) => t),
      shared,
      checks: pageChecks,
    }),
  );
  await writeFile(
    `${OUT}/requests/${slug}.json`,
    JSON.stringify(Object.fromEntries(tables.map((t) => [t.snapshot.id, t.exchanges]))),
  );
  if (unrecorded > 0)
    throw new Error(`${slug}: ${unrecorded} request(s) have no recording; run \`npm run eval\` online to record them.`);
  console.log(`${slug.padEnd(36)} ${summary.score[0]}/${summary.score[1]} checks  ${tables.length} tables`);
}

// ── Unit test results ───────────────────────────────────────────────────────

const units = [];
for (const file of (await readdir("test")).filter((f) => f.endsWith(".test.ts")).sort()) {
  let tap: string;
  try {
    tap = execFileSync("node", ["--test", "--test-reporter=tap", `test/${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    tap = (e as { stdout?: string }).stdout ?? "";
  }
  // Match top-level tests only, because the suite has no describe blocks. TAP escapes "#" in a name as "\#".
  const tests = [
    ...tap.matchAll(/^(ok|not ok) \d+ - (.+?)(?: # (SKIP|TODO)\b.*)?\n {2}---\n {2}duration_ms: ([\d.]+)/gm),
  ].map((m) => ({
    name: m[2]!.replaceAll("\\#", "#"),
    ok: m[1] === "ok" && m[3] === undefined,
    skipped: m[3] !== undefined,
    ms: Number(m[4]),
  }));
  if (tests.length === 0) throw new Error(`test/${file}: no test results (did it crash?)`);
  units.push({ file, tests });
}

// ── Parsing examples ────────────────────────────────────────────────────────

const PARSE_EXAMPLES = [
  "$0.025",
  "€1,200.50",
  "($3.00)",
  "-$3",
  "45%",
  ".312",
  "1.5B",
  "272K",
  "6' 6\"",
  "2:59",
  "20–25",
  "65+",
  "≤ 272K",
  "> 200K",
  "12-4",
  "35-10",
  "1,066",
  "3.2 GB",
  "829.8 m",
  "2,722 ft",
  "N/A",
  "—",
  "2023-01-01",
  "July 17, 2009",
  "December 1993",
  "3 days ago",
  "February 6",
  "July 16–22, 2021",
  "Jan 15, 1967 (1966)",
  "7:05 PM",
];
const DATE_FORM: Readonly<Record<DatePrecision, DateUnit>> = {
  month: "month",
  day: "date",
  minute: "datetime",
  relative: "ago",
};
const now = Date.now();
const parsing = PARSE_EXAMPLES.map((input) => {
  // A date without a year takes its year from the column. Any year shows the format.
  const date = isMissing(input) ? null : parseDate(input, { now, year: 2000 });
  return {
    input,
    missing: isMissing(input),
    date: date !== null || isDateLike(input),
    when: date === null ? null : formatDate(date.time, date.yearless ? "monthday" : DATE_FORM[date.precision], now),
    // A date is never also a number ("3 days ago" is not 3 days).
    parsed: date === null && !isDateLike(input) ? parseNumber(input) : null,
  };
});

const kinds = ["detect", "polarity", "transform", "order", "aggregates", "shared", "orientation"] as const;
const totals = Object.fromEntries(
  kinds.map((k) => {
    const of = checks.filter((c) => c.kind === k);
    return [
      k,
      {
        ok: of.filter((c) => c.ok).length,
        total: of.length,
        known: of.filter((c) => !c.ok && c.known !== null).length,
      },
    ];
  }),
);

await writeFile(
  `${OUT}/index.json`,
  JSON.stringify({
    model,
    requests,
    inputTokens,
    policy: DEFAULT_POLICY,
    maxTransposeRows: MAX_TRANSPOSE_ROWS,
    totals,
    checks,
    pages,
    units,
    parsing,
    samples,
    known,
  }),
);
console.log(
  `\n${checks.filter((c) => c.ok).length}/${checks.length} checks · ${units.reduce((n, u) => n + u.tests.length, 0)} unit tests · ${requests} requests replayed`,
);
