/**
 * Reads the tests site's data at build time (prerender). The files come from
 * scripts/tests-data.ts; `npm run demo` and `npm run web:dev` write them first.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { error } from "@sveltejs/kit";
import { groupSizes } from "../demo.ts";
import type { CaseSource, CaseTable, CheckKind, PageRequests, ScoredCheck, TestPage, TestsIndex } from "../tests/types.ts";

// Vite runs from web/, so the repository root is one level up.
const DATA = resolve(process.cwd(), "..", "demo", "tests");

const read = async <T>(path: string): Promise<T> => {
  try {
    return JSON.parse(await readFile(resolve(DATA, path), "utf8")) as T;
  } catch {
    error(500, `Missing ${path} in demo/tests/: run \`node scripts/tests-data.ts\`.`);
  }
};

// Read once per build; in dev, on every request, so regenerated data shows without a restart.
let index: Promise<TestsIndex> | undefined;
export const readIndex = (): Promise<TestsIndex> => (import.meta.env.DEV ? read<TestsIndex>("index.json") : (index ??= read<TestsIndex>("index.json")));
export const readPage = (slug: string): Promise<TestPage> =>
  /^[a-z0-9-]+$/.test(slug) ? read<TestPage>(`pages/${slug}.json`) : error(404, "No such page");
export const readRequests = (slug: string): Promise<PageRequests> =>
  /^[a-z0-9-]+$/.test(slug) ? read<PageRequests>(`requests/${slug}.json`) : error(404, "No such page");

const ordinal = (n: number) => (n === 2 ? "second" : n === 3 ? "third" : `${n}th`);

/**
 * The tables a check kind is made on, each with its own checks of that kind.
 * A shared-scale check names columns in several tables; each of those tables
 * carries it, under its own header. Tables with a failing check come first.
 */
export const readCases = async (kind: CheckKind): Promise<CaseTable[]> => {
  const index = await readIndex();
  const bySlug = new Map<string, ScoredCheck[]>();
  for (const c of index.checks) if (c.kind === kind) bySlug.set(c.page, [...(bySlug.get(c.page) ?? []), c]);
  const cases: CaseTable[] = [];
  for (const summary of index.pages) {
    const checks = bySlug.get(summary.slug);
    if (checks === undefined) continue;
    const page = await readPage(summary.slug);
    const sizes = groupSizes(page.judgment);
    const source: CaseSource =
      summary.source === null
        ? { label: "Synthetic test page", url: null }
        : { label: `${new URL(summary.source.url).hostname.replace(/^www\./, "")} · ${summary.name}`, url: summary.source.url };
    const titles = page.tables.map((t) => t.snapshot.title ?? "Untitled table");
    page.tables.forEach((t, i) => {
      const id = t.snapshot.id;
      const own = checks.flatMap((c): ScoredCheck[] => {
        if (c.table === id) return [c];
        if (c.kind !== "shared" || c.column === null) return [];
        const member = c.column.split(" + ").find((k) => k.startsWith(`${id}:`));
        return member === undefined ? [] : [{ ...c, table: id, column: member.slice(id.length + 1) }];
      });
      if (own.length === 0) return;
      const judgment = page.judgment.tables.find((j) => j.id === id);
      if (judgment === undefined) return;
      // Two tables with one title (regular season and postseason) are told apart by position.
      const same = titles.filter((x) => x === titles[i]).length;
      const nth = titles.slice(0, i + 1).filter((x) => x === titles[i]).length;
      cases.push({
        slug: summary.slug,
        id,
        title: same > 1 ? `${titles[i]} (${nth === 1 ? "first" : ordinal(nth)} of ${same})` : titles[i]!,
        source,
        snapshot: t.snapshot,
        judgment,
        groupSizes: sizes,
        checks: own,
        requests: t.requests.count,
      });
    });
  }
  return cases.sort((a, b) => Number(a.checks.every((c) => c.ok)) - Number(b.checks.every((c) => c.ok)));
};
