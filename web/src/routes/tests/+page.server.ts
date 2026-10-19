import { publicChecks, readIndex } from "#lib/server/tests.ts";
import { KINDS } from "#lib/tests/kinds.ts";

export const load = async () => {
  const index = await readIndex();
  const { checks, totals, hidden } = publicChecks(index);
  const names = new Map(index.pages.map((p) => [p.slug, p.name]));
  const known = checks.flatMap((c) => {
    const kind = KINDS.find((k) => k.kind === c.kind)!;
    return c.ok || c.known === null
      ? []
      : [{ check: { slug: kind.slug, title: kind.title }, page: names.get(c.page) ?? c.page, column: c.column, why: c.known, anchor: `${c.page}-${c.table}` }];
  });
  return {
    pages: index.pages.filter((p) => p.origin === "live"),
    synthetic: index.pages.filter((p) => p.origin === "synthetic").length,
    hidden,
    known,
    totals,
    requests: index.requests,
    inputTokens: index.inputTokens,
    checkCount: checks.length,
    passCount: checks.filter((c) => c.ok).length,
  };
};
