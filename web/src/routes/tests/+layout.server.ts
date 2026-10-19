import { publicChecks, readIndex } from "#lib/server/tests.ts";

export const load = async () => {
  const index = await readIndex();
  return {
    run: { model: index.model, requests: index.requests, inputTokens: index.inputTokens },
    totals: publicChecks(index).totals,
    unitCount: index.units.reduce((n, u) => n + u.tests.length, 0),
    unitsOk: index.units.every((u) => u.tests.every((t) => t.ok)),
  };
};
