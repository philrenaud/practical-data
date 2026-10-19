import { readIndex } from "#lib/server/tests.ts";
import { KINDS } from "#lib/tests/kinds.ts";

export const load = async () => {
  const { checks, pages, totals, requests, inputTokens } = await readIndex();
  const names = new Map(pages.map((p) => [p.slug, p.name]));
  const known = checks.flatMap((c) =>
    c.ok || c.known === null
      ? []
      : [{ check: { slug: KINDS.find((k) => k.kind === c.kind)!.slug, title: KINDS.find((k) => k.kind === c.kind)!.title }, page: names.get(c.page) ?? c.page, column: c.column, why: c.known, anchor: `${c.page}-${c.table}` }],
  );
  return { pages, known, totals, requests, inputTokens, checkCount: checks.length, passCount: checks.filter((c) => c.ok).length };
};
