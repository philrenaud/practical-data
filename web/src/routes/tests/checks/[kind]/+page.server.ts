import { error } from "@sveltejs/kit";
import { readIndex } from "#lib/server/tests.ts";
import { KINDS, kindBySlug } from "#lib/tests/kinds.ts";

export const entries = () => KINDS.map((k) => ({ kind: k.slug }));

export const load = async ({ params }) => {
  const info = kindBySlug(params.kind);
  if (info === undefined) error(404, "No such check");
  const index = await readIndex();
  return {
    slug: info.slug,
    rule: info.rule(index.policy),
    checks: index.checks.filter((c) => c.kind === info.kind),
    samples: info.questions.flatMap((q) => (index.samples[q] === undefined ? [] : [index.samples[q]])),
    names: Object.fromEntries(index.pages.map((p) => [p.slug, p.name])),
  };
};
