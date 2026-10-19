/**
 * Reads the tests site's data at build time (prerender). The files come from
 * scripts/tests-data.ts; `npm run demo` and `npm run web:dev` write them first.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { error } from "@sveltejs/kit";
import { groupSizes } from "../demo.ts";
import { parseNumber } from "../../../../src/core/parse.ts";
import type { CaseSource, CaseTable, CheckKind, PageRequests, ScoredCheck, ShareGroup, TestPage, TestsIndex } from "../tests/types.ts";

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

/**
 * The site shows checks on real pages only. Synthetic pages stay in the eval
 * as regression tests (CI runs them), but invented data proves nothing to a reader.
 */
export const isPublic = (index: TestsIndex, slug: string): boolean => index.pages.find((p) => p.slug === slug)?.origin === "live";

/** The checks the site shows, and totals over them by kind. */
export const publicChecks = (index: TestsIndex) => {
  const checks = index.checks.filter((c) => isPublic(index, c.page));
  const totals = Object.fromEntries(
    Object.keys(index.totals).map((k) => {
      const of = checks.filter((c) => c.kind === k);
      return [k, { ok: of.filter((c) => c.ok).length, total: of.length, known: of.filter((c) => !c.ok && c.known !== null).length }];
    }),
  ) as TestsIndex["totals"];
  return { checks, totals, hidden: index.checks.length - checks.length };
};

/**
 * The tables a check kind is made on, each with its own checks of that kind.
 * A shared-scale check names columns in several tables; each of those tables
 * carries it, under its own header. Tables with a failing check come first.
 */
export const readCases = async (kind: CheckKind): Promise<CaseTable[]> => {
  const index = await readIndex();
  const bySlug = new Map<string, ScoredCheck[]>();
  for (const c of publicChecks(index).checks) if (c.kind === kind) bySlug.set(c.page, [...(bySlug.get(c.page) ?? []), c]);
  const cases: CaseTable[] = [];
  for (const summary of index.pages) {
    const checks = bySlug.get(summary.slug);
    if (checks === undefined || summary.source === null) continue;
    const page = await readPage(summary.slug);
    const sizes = groupSizes(page.judgment);
    const source: CaseSource = { label: `${new URL(summary.source.url).hostname.replace(/^www\./, "")} · ${summary.name}`, url: summary.source.url };
    const shown: CaseTable[] = [];
    page.tables.forEach((t, i) => {
      const id = t.snapshot.id;
      const own = checks.flatMap((c): ScoredCheck[] => {
        if (c.table === id) return [c];
        if (c.kind !== "shared" || c.column === null) return [];
        const member = c.column.split(" + ").find((k) => k.startsWith(`${id}:`));
        return member === undefined ? [] : [{ ...c, table: id, column: member.slice(id.length + 1), group: c.column }];
      });
      if (own.length === 0) return;
      const judgment = page.judgment.tables.find((j) => j.id === id);
      if (judgment === undefined) return;
      shown.push({
        slug: summary.slug,
        id,
        title: t.snapshot.title ?? "Untitled table",
        position: i + 1,
        source,
        snapshot: t.snapshot,
        judgment,
        groupSizes: sizes,
        checks: own,
        requests: t.requests.count,
        questions: t.requests.questions,
      });
    });
    // Two shown tables with one title (a season table and a postseason table) are told apart by position on the page.
    for (const c of shown) {
      if (shown.filter((x) => x.title === c.title).length > 1) cases.push({ ...c, title: `${c.title}, table ${c.position} on the page` });
      else cases.push(c);
    }
  }
  return cases.sort((a, b) => Number(a.checks.every((c) => c.ok)) - Number(b.checks.every((c) => c.ok)));
};

/** Smallest and largest number in one column, as the parser reads its cells. */
const rangeOf = (rows: readonly (readonly string[])[], col: number): [number, number] | null => {
  const values = rows.map((r) => parseNumber(r[col] ?? "")?.value).filter((v): v is number => v !== undefined && Number.isFinite(v));
  return values.length === 0 ? null : [Math.min(...values), Math.max(...values)];
};

/**
 * One shared-scale check: the columns it names, each with its own range of
 * values, and the scale each was painted on (one domain when shared).
 */
export const sharedGroups = (cases: readonly CaseTable[]): ShareGroup[] => {
  const groups = new Map<string, { check: ScoredCheck; members: ShareGroup["members"][number][] }>();
  for (const t of cases) {
    for (const c of t.checks) {
      if (c.kind !== "shared" || c.column === null) continue;
      const key = `${t.slug}|${c.group}`;
      const col = t.snapshot.headers.indexOf(c.column);
      const e = t.judgment.encodings.find((x) => x.header === c.column);
      const member = {
        key: `${t.slug}:${t.id}`,
        title: t.title,
        header: c.column,
        range: col < 0 ? null : rangeOf(t.snapshot.rows, col),
        domain: e?.kind === "quantitative" ? e.domain : null,
        format: col < 0 ? "" : (t.snapshot.rows.find((r) => parseNumber(r[col] ?? "") !== null)?.[col] ?? ""),
      };
      const g = groups.get(key);
      if (g === undefined) groups.set(key, { check: c, members: [member] });
      else g.members.push(member);
    }
  }
  return [...groups.values()];
};
