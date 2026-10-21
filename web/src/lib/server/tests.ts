/**
 * Build-time readers for the tests site data in demo/tests/. The files come
 * from scripts/tests-data.ts. `npm run demo` and `npm run web:dev` run it first.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { error } from "@sveltejs/kit";
import { groupSizes } from "../demo.ts";
import { parseNumber } from "../../../../src/core/parse.ts";
import type {
  CaseSource,
  CaseTable,
  CheckKind,
  PageRequests,
  ScoredCheck,
  ShareGroup,
  TestPage,
  TestsIndex,
} from "../tests/types.ts";

// Vite runs from web/, so the repository root is one level up.
const DATA = resolve(process.cwd(), "..", "demo", "tests");

const read = async <T>(path: string): Promise<T> => {
  try {
    return JSON.parse(await readFile(resolve(DATA, path), "utf8")) as T;
  } catch {
    error(500, `Missing ${path} in demo/tests/: run \`node scripts/tests-data.ts\`.`);
  }
};

// Cache the index for the build. In dev, read it on each request so that regenerated data shows without a restart.
let index: Promise<TestsIndex> | undefined;
export const readIndex = (): Promise<TestsIndex> =>
  import.meta.env.DEV ? read<TestsIndex>("index.json") : (index ??= read<TestsIndex>("index.json"));
const readPage = (slug: string): Promise<TestPage> =>
  /^[a-z0-9-]+$/.test(slug) ? read<TestPage>(`pages/${slug}.json`) : error(404, "No such page");
export const readRequests = (slug: string): Promise<PageRequests> =>
  /^[a-z0-9-]+$/.test(slug) ? read<PageRequests>(`requests/${slug}.json`) : error(404, "No such page");

/**
 * Returns true if the page is a live fixture. The site shows only live pages.
 * Synthetic pages stay in the eval, and CI runs them, but invented data proves
 * nothing about real tables.
 */
const isPublic = (index: TestsIndex, slug: string): boolean =>
  index.pages.find((p) => p.slug === slug)?.origin === "live";

/** Returns the checks on live pages, their totals by kind, and the number of hidden checks. */
export const publicChecks = (index: TestsIndex) => {
  const checks = index.checks.filter((c) => isPublic(index, c.page));
  const totals = Object.fromEntries(
    Object.keys(index.totals).map((k) => {
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
  ) as TestsIndex["totals"];
  return { checks, totals, hidden: index.checks.length - checks.length };
};

/**
 * Returns the tables that have checks of one kind, each with its checks of
 * that kind. A shared-scale check names columns in several tables. Each of
 * those tables gets a copy of the check with its own header. Tables with a
 * failing check come first.
 */
export const readCases = async (kind: CheckKind): Promise<CaseTable[]> => {
  const index = await readIndex();
  const bySlug = new Map<string, ScoredCheck[]>();
  for (const c of publicChecks(index).checks)
    if (c.kind === kind) bySlug.set(c.page, [...(bySlug.get(c.page) ?? []), c]);
  const cases: CaseTable[] = [];
  for (const summary of index.pages) {
    const checks = bySlug.get(summary.slug);
    if (checks === undefined || summary.source === null) continue;
    const page = await readPage(summary.slug);
    const sizes = groupSizes(page.judgment);
    const source: CaseSource = {
      label: `${new URL(summary.source.url).hostname.replace(/^www\./, "")} · ${summary.name}`,
      url: summary.source.url,
    };
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
    // If two tables have the same title, add each table's position on the page.
    for (const c of shown) {
      if (shown.filter((x) => x.title === c.title).length > 1)
        cases.push({ ...c, title: `${c.title}, table ${c.position} on the page` });
      else cases.push(c);
    }
  }
  return cases.sort((a, b) => Number(a.checks.every((c) => c.ok)) - Number(b.checks.every((c) => c.ok)));
};

/** Returns the smallest and largest parsed value in a column, or null if no cell parses. */
const rangeOf = (rows: readonly (readonly string[])[], col: number): [number, number] | null => {
  const values = rows
    .map((r) => parseNumber(r[col] ?? "")?.value)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  return values.length === 0 ? null : [Math.min(...values), Math.max(...values)];
};

/** Returns the first column whose cells are mostly not numbers. That column names the rows. */
const labelColumn = (t: CaseTable): number => {
  const i = t.snapshot.headers.findIndex(
    (_, c) => t.snapshot.rows.filter((r) => parseNumber(r[c] ?? "") === null).length > t.snapshot.rows.length / 2,
  );
  return i < 0 ? 0 : i;
};

/**
 * Groups the shared-scale checks in `cases`. Each group lists the columns that
 * its check names, with each column's range of values and painted scale.
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
        // Use a cell with a single number. A range such as "59,488–62,013" would format every axis label as a range.
        format:
          col < 0
            ? ""
            : (t.snapshot.rows.find((r) => {
                const n = parseNumber(r[col] ?? "");
                return n !== null && n.range === null;
              })?.[col] ?? ""),
        encoding: e ?? null,
        labelHeader: t.snapshot.headers[labelColumn(t)] ?? "",
        // Each row's label and its cell in the shared column.
        rows:
          col < 0
            ? []
            : t.snapshot.rows.map((r) => ({
                label: r[labelColumn(t)] ?? "",
                cell: r[col] ?? "",
                value: parseNumber(r[col] ?? "")?.value ?? null,
              })),
        groupSizes: t.groupSizes,
      };
      const g = groups.get(key);
      if (g === undefined) groups.set(key, { check: c, members: [member] });
      else g.members.push(member);
    }
  }
  return [...groups.values()];
};
