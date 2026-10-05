/**
 * Builds demo/data.json: trimmed tables from the fixture snapshots plus the
 * judgments the real pipeline makes for them. Answers come from
 * fixtures/recordings (live Jev only for questions not yet recorded), so the
 * demo shows actual model output, never hand-written colors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { PageJudgment, PageSnapshot, TableSnapshot } from "../src/core/types.ts";
import { judgePage } from "../src/decide/judge.ts";
import { recordedJev } from "./lib/cache.ts";

interface Pick {
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows?: number;
  /** Keep only rows whose first cell matches. */
  readonly where?: RegExp;
  /** Keep up to `per` rows for each distinct value of `column`, in page order. */
  readonly spread?: { readonly column: string; readonly per: number };
  /** Optional title override for the trimmed table. */
  readonly title?: string;
}

interface Section {
  readonly id: string;
  readonly slug: string;
  readonly heading: string;
  readonly source: string;
  readonly caption: string;
  readonly picks: readonly Pick[];
}

const SECTIONS: readonly Section[] = [
  {
    id: "pricing",
    slug: "github-copilot-pricing",
    heading: "Model pricing",
    source: "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing",
    caption:
      "Prices are lower-is-better and span two orders of magnitude, so they get a log scale. The two vendor tables share one scale, and Category reads as an ordered set of grades.",
    picks: [
      { table: "t0", columns: ["Model", "Category", "Input", "Cached input", "Output"], rows: 10 },
      { table: "t1", columns: ["Model", "Category", "Input", "Cached input", "Output"], rows: 8 },
    ],
  },
  {
    id: "pitching",
    slug: "bbref-tarik-skubal",
    heading: "Pitching stats",
    source: "https://www.baseball-reference.com/players/s/skubata01.shtml",
    caption:
      "ERA, WHIP and FIP are lower-is-better; strikeouts per nine are higher-is-better. Season and age are numbers, but they place a row in time, so they stay plain.",
    picks: [{ table: "t1", columns: ["Season", "Age", "Team", "W", "L", "ERA", "IP", "SO", "WHIP", "FIP", "ERA+", "SO9"] }],
  },
  {
    id: "pace",
    slug: "bbref-rules-changes",
    heading: "Pace of play",
    source: "https://www.baseball-reference.com/friv/rules-changes-stats.shtml",
    caption:
      "Game length (2:41) and time between plays (2:11) are read as clock durations: 3:00 is one more than 2:59. Shorter is better, so the 2023 pitch clock shows up as a wall of green.",
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
  {
    id: "benchmarks",
    slug: "cloudflare-clef",
    heading: "Benchmarks, by row",
    source: "https://blog.cloudflare.com/clef-decision-models/",
    caption:
      "Here each row is a benchmark and each column a model, so the model judges the table row-wise: every benchmark gets its own scale, and each row's best model is the greenest.",
    picks: [
      {
        table: "t0",
        columns: ["Benchmark", "Clef", "Clef-flash", "Jev", "DiffusionGemma Jev", "Kev 9B", "Laya"],
        title: "Benchmark scores by model",
      },
    ],
  },
  {
    id: "cards",
    slug: "mtggoldfish-modern-price-index",
    heading: "Card prices",
    source: "https://www.mtggoldfish.com/index/modern",
    caption:
      "Rarity is ordered Common → Uncommon → Rare → Mythic from pairwise judgments. Prices run from $4 to $237, so they get a log scale, read as lower-is-better; weekly change reads as higher-is-better.",
    picks: [
      { table: "t1", columns: ["Card", "Set", "Rarity", "Price", "Weekly (%)"], spread: { column: "Rarity", per: 4 } },
    ],
  },
  {
    id: "storms",
    slug: "wiki-costliest-atlantic-hurricanes",
    heading: "Hurricanes",
    source: "https://en.wikipedia.org/wiki/List_of_costliest_Atlantic_hurricanes",
    caption: "Storm classification is text, but the model orders it: Tropical storm, then Category 1 through 5.",
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
    heading: "Populations",
    source: "https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population",
    caption: "The first row is the World total. The model flags it as an aggregate, so it is left out of the scale instead of washing out every country.",
    picks: [{ table: "t0", columns: ["Location", "Population", "% of world", "Date"], rows: 12 }],
  },
  {
    id: "traps",
    slug: "edge-cases",
    heading: "Numbers that aren't amounts",
    source: "",
    caption: "Jersey numbers, birth years and zip codes are numeric but not comparable, so they stay plain. Height and scoring are measures.",
    picks: [{ table: "t1", columns: ["Player", "Jersey #", "Born", "Zip code", "Height (in)", "Points per game"] }],
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

const layer = recordedJev();

const out: { section: Omit<Section, "picks" | "slug">; page: PageSnapshot; judgment: PageJudgment }[] = [];
for (const section of SECTIONS) {
  const full = JSON.parse(await readFile(`fixtures/snapshots/${section.slug}.json`, "utf8")) as PageSnapshot;
  const tables = section.picks.map((pick, i) => {
    const t = full.tables.find((x) => x.id === pick.table);
    if (t === undefined) throw new Error(`${section.slug}: no table ${pick.table}`);
    return trim(t, pick, `${section.id}-${i}`);
  });
  const page: PageSnapshot = { url: section.source, title: full.title, tables };
  const judgment = await Effect.runPromise(judgePage(page).pipe(Effect.provide(layer)));
  const { picks: _picks, slug: _slug, ...meta } = section;
  out.push({ section: meta, page, judgment });
  const colored = judgment.tables.flatMap((t) => t.encodings.map((e) => e.header));
  console.log(`${section.id.padEnd(11)} ${colored.join(", ")}`);
}
await mkdir("demo", { recursive: true });
await writeFile("demo/data.json", JSON.stringify(out));
