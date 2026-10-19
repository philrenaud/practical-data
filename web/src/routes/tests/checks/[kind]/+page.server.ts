import { error } from "@sveltejs/kit";
import { readCases, readIndex } from "#lib/server/tests.ts";
import { KINDS, kindBySlug } from "#lib/tests/kinds.ts";

export const entries = () => KINDS.map((k) => ({ kind: k.slug }));

export const load = async ({ params }) => {
  const info = kindBySlug(params.kind);
  if (info === undefined) error(404, "No such check");
  const [index, cases] = await Promise.all([readIndex(), readCases(info.kind)]);
  const checks = index.checks.filter((c) => c.kind === info.kind);
  return {
    slug: info.slug,
    rule: info.rule(index.policy, index.maxTransposeRows),
    total: checks.length,
    passed: checks.filter((c) => c.ok).length,
    known: checks.filter((c) => !c.ok && c.known !== null).length,
    samples: info.questions.flatMap((q) => (index.samples[q] === undefined ? [] : [index.samples[q]])),
    cases,
  };
};
