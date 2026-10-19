import { error } from "@sveltejs/kit";
import { publicChecks, readCases, readIndex, sharedGroups } from "#lib/server/tests.ts";
import { KINDS, kindBySlug } from "#lib/tests/kinds.ts";

export const entries = () => KINDS.map((k) => ({ kind: k.slug }));

export const load = async ({ params }) => {
  const info = kindBySlug(params.kind);
  if (info === undefined) error(404, "No such check");
  const [index, cases] = await Promise.all([readIndex(), readCases(info.kind)]);
  const checks = publicChecks(index).checks.filter((c) => c.kind === info.kind);
  const shown = new Set(cases.map((c) => `${c.slug}:${c.id}`));
  return {
    slug: info.slug,
    rule: info.rule(index.policy, index.maxTransposeRows),
    total: checks.length,
    passed: checks.filter((c) => c.ok).length,
    known: checks.filter((c) => !c.ok && c.known !== null).length,
    // Example questions only from tables this page shows.
    samples: info.questions.flatMap((q) => {
      const s = index.samples[q];
      return s === undefined || (s.table !== null && !shown.has(`${s.page}:${s.table}`)) ? [] : [s];
    }),
    cases,
    groups: info.kind === "shared" ? sharedGroups(cases) : [],
  };
};
