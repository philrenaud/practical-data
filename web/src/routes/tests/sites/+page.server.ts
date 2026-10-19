import { publicChecks, readIndex } from "#lib/server/tests.ts";
import { KINDS } from "#lib/tests/kinds.ts";

export const load = async () => {
  const index = await readIndex();
  const checks = publicChecks(index).checks;
  return {
    sites: index.pages
      .filter((p) => p.source !== null)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        title: p.source!.title,
        url: p.source!.url,
        rights: p.source!.rights,
        host: new URL(p.source!.url).hostname.replace(/^www\./, ""),
        kinds: KINDS.filter((k) => checks.some((c) => c.page === p.slug && c.kind === k.kind)).map((k) => ({ slug: k.slug, title: k.title })),
      })),
  };
};
