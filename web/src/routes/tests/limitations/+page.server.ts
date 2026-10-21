import { publicChecks, readIndex } from "#lib/server/tests.ts";
import { KINDS } from "#lib/tests/kinds.ts";

/** Groups the known failures by reason. Each reason is one limitation, with the checks that it explains. */
export const load = async () => {
  const index = await readIndex();
  const names = new Map(index.pages.map((p) => [p.slug, p.name]));
  const byReason = new Map<
    string,
    { kind: string; slug: string; page: string; column: string | null; anchor: string }[]
  >();
  for (const c of publicChecks(index).checks) {
    if (c.ok || c.known === null) continue;
    const kind = KINDS.find((k) => k.kind === c.kind)!;
    // A shared-scale check names its columns as "t0:Death toll + t1:Death toll". Show each header once.
    const example = {
      kind: kind.title,
      slug: kind.slug,
      page: names.get(c.page) ?? c.page,
      column:
        c.kind === "shared" && c.column !== null
          ? [...new Set(c.column.split(" + ").map((m) => m.replace(/^t\d+:/, "")))].join(", ")
          : c.column,
      anchor: `${c.page}-${c.table ?? c.column?.split(":")[0]}`,
    };
    byReason.set(c.known, [...(byReason.get(c.known) ?? []), example]);
  }
  return {
    limitations: [...byReason].map(([reason, examples]) => {
      // The first sentence is the title. The rest is the body.
      const cut = reason.indexOf(". ");
      return {
        title: cut < 0 ? reason : reason.slice(0, cut + 1),
        body: cut < 0 ? "" : reason.slice(cut + 2),
        examples,
      };
    }),
  };
};
