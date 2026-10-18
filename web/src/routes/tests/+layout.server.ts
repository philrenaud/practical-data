import { readIndex } from "#lib/server/tests.ts";

export const load = async () => {
  const index = await readIndex();
  return {
    run: { model: index.model, requests: index.requests, inputTokens: index.inputTokens },
    totals: index.totals,
    pages: index.pages.map((p) => ({ slug: p.slug, name: p.name, origin: p.origin, score: p.score, known: p.known })),
    unitCount: index.units.reduce((n, u) => n + u.tests.length, 0),
    unitsOk: index.units.every((u) => u.tests.every((t) => t.ok)),
  };
};
