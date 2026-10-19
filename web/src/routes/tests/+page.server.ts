import { publicChecks, readIndex } from "#lib/server/tests.ts";

export const load = async () => {
  const index = await readIndex();
  const { checks, totals, hidden } = publicChecks(index);
  return {
    pages: index.pages.filter((p) => p.origin === "live").length,
    synthetic: index.pages.filter((p) => p.origin === "synthetic").length,
    hidden,
    totals,
    limitations: new Set(checks.flatMap((c) => (c.ok || c.known === null ? [] : [c.known]))).size,
    checkCount: checks.length,
    passCount: checks.filter((c) => c.ok).length,
  };
};
