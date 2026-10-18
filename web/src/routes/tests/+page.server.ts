import { readIndex } from "#lib/server/tests.ts";

export const load = async () => {
  const { checks, pages, policy, known, totals, requests, inputTokens } = await readIndex();
  return { pages, policy, known, totals, requests, inputTokens, checkCount: checks.length, passCount: checks.filter((c) => c.ok).length };
};
