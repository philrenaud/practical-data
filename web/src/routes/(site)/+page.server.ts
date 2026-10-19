import { publicChecks, readIndex } from "#lib/server/tests.ts";

export const load = async () => {
  const { checks } = publicChecks(await readIndex());
  return { tests: { passed: checks.filter((c) => c.ok).length, total: checks.length } };
};
