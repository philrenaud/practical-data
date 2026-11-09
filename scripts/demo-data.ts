/**
 * Builds demo/data.json from trimmed tables in the fixture snapshots and the
 * judgments that the real pipeline makes for them. Answers replay from
 * fixtures/recordings. Only a question with no recording calls Jev, which
 * needs TYPESAFE_API_KEY. The demo shows model output, never hand-written
 * colors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { PageJudgment, PageSnapshot, TableSnapshot } from "../src/core/types.ts";
import { judgePage } from "../src/decide/judge.ts";
import { recordedJev } from "./lib/cache.ts";

// --quiet keeps one summary line, for `npm run web:dev`.
const { values: args } = parseArgs({ options: { quiet: { type: "boolean", default: false } } });

interface Pick {
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows?: number;
  /** Keep only rows whose first cell matches. */
  readonly where?: RegExp;
  /** Keep up to `per` rows for each distinct value of `column`, in page order. */
  readonly spread?: { readonly column: string; readonly per: number };
  /** Replaces the table's title. */
  readonly title?: string;
}

interface Section {
  readonly id: string;
  readonly slug: string;
  readonly heading: string;
  readonly source: string;
  readonly caption: string;
  /** The tests-site page that checks this capability. */
  readonly checks: string;
  readonly picks: readonly Pick[];
}

const SECTIONS: readonly Section[] = [
  {
    id: "pitching",
    slug: "bbref-tarik-skubal",
    heading: "Figures out which direction is better",
    source: "https://www.baseball-reference.com/players/s/skubata01.shtml",
    caption:
      'If we shaded all the columns in this table with a uniform "big numbers = green, small numbers = red" rule, it would go against the meaning of a few of them (Losses, and ERA is better when it\'s lower, for example). The model picks the direction for each column, given its title and context.',
    checks: "/tests/checks/direction",
    picks: [
      {
        table: "t1",
        columns: ["Season", "Age", "Team", "W", "L", "ERA", "IP", "SO", "WHIP", "FIP", "ERA+", "SO9"],
        rows: 7,
      },
    ],
  },
  {
    id: "traps",
    slug: "edge-cases",
    heading: "Knows which numbers are amounts",
    source: "",
    caption:
      "A lot of numbers aren't amounts; if you try to shade everything numeric, identifying things like Jersey # or Zip Code would look like they're on a scale. Practical Data asks the decision model whether a column is really a measure first, so identifiers stay are ignored.",
    checks: "/tests/checks/shade-or-not",
    picks: [{ table: "t1", columns: ["Player", "Jersey #", "Born", "Zip code", "Height (in)", "Points per game"] }],
  },
  {
    id: "cards",
    slug: "mtggoldfish-modern-price-index",
    heading: "Knows when to use a log or linear scale",
    source: "https://www.mtggoldfish.com/index/modern",
    caption:
      "On a linear scale, the one $237 card here would flatten everything under $30 into nearly the same red colour. The model notices when ratios matter more than differences and moves that column to a log scale, so the cheap cards still read as different from each other.",
    checks: "/tests/checks/scale",
    picks: [
      { table: "t1", columns: ["Card", "Set", "Rarity", "Price", "Weekly (%)"], spread: { column: "Rarity", per: 4 } },
    ],
  },
  {
    id: "storms",
    slug: "wiki-costliest-atlantic-hurricanes",
    heading: "Puts labels in order",
    source: "https://en.wikipedia.org/wiki/List_of_costliest_Atlantic_hurricanes",
    caption:
      "Works on words, not just numbers! The model can put labels in order when the presence of that order is implied (like tropical storms, or card rarity, or medal rankings).",
    checks: "/tests/checks/label-order",
    picks: [
      {
        table: "t1",
        columns: ["Name", "Nominal damage (Billions USD)", "Season", "Storm classification at peak intensity"],
        rows: 16,
      },
    ],
  },
  {
    id: "population",
    slug: "wiki-countries-by-population",
    heading: "Ignores Total and Average rows",
    source: "https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population",
    caption:
      "The first row here is the World total; considered alongside the others, it would dwarf all their numbers and make them almost indistinguishable. The model flags totals and averages as aggregates and scales around them.",
    checks: "/tests/checks/totals",
    picks: [{ table: "t0", columns: ["Location", "Population", "% of world", "Date"], rows: 12 }],
  },
  {
    id: "pricing",
    slug: "github-copilot-pricing",
    heading: "Multiple tables can share a scale",
    source: "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing",
    caption:
      "Practical data looks for same-named columns in similar contexts and aligns their scales accordingly so they're more easily compared at a glance.",
    checks: "/tests/checks/shared-scales",
    picks: [
      { table: "t0", columns: ["Model", "Category", "Input", "Cached input", "Output"], rows: 10 },
      { table: "t1", columns: ["Model", "Category", "Input", "Cached input", "Output"], rows: 8 },
    ],
  },
  {
    id: "benchmarks",
    slug: "cloudflare-clef",
    heading: "Notices when the table is meant to be read row-wise",
    source: "https://blog.cloudflare.com/clef-decision-models/",
    caption:
      "Not every table compares down the column. Here each row is one benchmark and the columns are models, so column-wise shading would compare numbers that have nothing to do with each other. The model reads the orientation and gives each row its own scale.",
    checks: "/tests/checks/orientation",
    picks: [
      {
        table: "t0",
        columns: ["Benchmark", "Clef", "Clef-flash", "Jev", "DiffusionGemma Jev", "Kev 9B", "Laya"],
        title: "Benchmark scores by model",
      },
    ],
  },
  {
    id: "pace",
    slug: "bbref-rules-changes",
    heading: "Understands times and durations",
    source: "https://www.baseball-reference.com/friv/rules-changes-stats.shtml",
    caption:
      "It would be easy to treat 2:42 as text, or a ratio. Practical Data parses it as a duration, and understands minutes/hours correctly (3:00 is one more than 2:59).",
    checks: "/tests/units",
    picks: [
      {
        table: "t10",
        columns: ["Year", "G", "AvgTime", "%≥3:30", "Avg Tm Btwn PA", "Avg Tm Btwn BIP"],
        // Full seasons only (the page also has month rows), 2026 back to 2011.
        where: /^\d{4}$/,
        rows: 16,
      },
    ],
  },
];

const spreadRows = (t: TableSnapshot, pick: Pick): readonly (readonly string[])[] => {
  const rows = pick.where === undefined ? t.rows : t.rows.filter((r) => pick.where!.test(r[0] ?? ""));
  if (pick.spread === undefined) return rows.slice(0, pick.rows ?? rows.length);
  const col = t.headers.indexOf(pick.spread.column);
  const taken = new Map<string, number>();
  return rows.filter((r) => {
    const v = r[col] ?? "";
    const n = taken.get(v) ?? 0;
    taken.set(v, n + 1);
    return n < pick.spread!.per;
  });
};

const trim = (t: TableSnapshot, pick: Pick, id: string): TableSnapshot => {
  const idx = pick.columns.map((c) => {
    const i = t.headers.findIndex((h) => h.replace(/\[[^\]]{1,6}\]/g, "").trim() === c);
    if (i < 0) throw new Error(`${t.id}: no column "${c}" in ${JSON.stringify(t.headers)}`);
    return i;
  });
  return {
    id,
    title: pick.title ?? t.title,
    headers: idx.map((i) => t.headers[i]!.replace(/\[[^\]]{1,6}\]/g, "").trim()),
    rows: spreadRows(t, pick).map((r) => idx.map((i) => r[i] ?? "")),
  };
};

const model = recordedJev();

const out: { section: Omit<Section, "picks" | "slug">; page: PageSnapshot; judgment: PageJudgment }[] = [];
for (const section of SECTIONS) {
  const full = JSON.parse(await readFile(`fixtures/snapshots/${section.slug}.json`, "utf8")) as PageSnapshot;
  const tables = section.picks.map((pick, i) => {
    const t = full.tables.find((x) => x.id === pick.table);
    if (t === undefined) throw new Error(`${section.slug}: no table ${pick.table}`);
    return trim(t, pick, `${section.id}-${i}`);
  });
  const page: PageSnapshot = { url: section.source, title: full.title, tables };
  const judgment = await judgePage(model, page);
  const { picks: _picks, slug: _slug, ...meta } = section;
  out.push({ section: meta, page, judgment });
  const colored = judgment.tables.flatMap((t) => t.encodings.map((e) => e.header));
  if (!args.quiet) console.log(`${section.id.padEnd(11)} ${colored.join(", ")}`);
}
await mkdir("demo", { recursive: true });
await writeFile("demo/data.json", JSON.stringify(out));
if (args.quiet) {
  const columns = out.reduce((n, s) => n + s.judgment.tables.reduce((m, t) => m + t.encodings.length, 0), 0);
  console.log(`demo/data.json: ${out.length} sections · ${columns} shaded columns`);
}
