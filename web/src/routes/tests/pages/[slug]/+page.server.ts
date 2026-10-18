import { readIndex, readPage } from "#lib/server/tests.ts";

export const entries = async () => (await readIndex()).pages.map((p) => ({ slug: p.slug }));

export const load = async ({ params }) => {
  const [page, index] = await Promise.all([readPage(params.slug), readIndex()]);
  return { page, policy: index.policy };
};
