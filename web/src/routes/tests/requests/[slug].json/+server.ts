// The recorded requests for one test page, as a static file. Requests.svelte
// fetches it when a table's requests panel opens. Only live pages get a file,
// because the site shows no synthetic page.
import { json } from "@sveltejs/kit";
import { readIndex, readRequests } from "#lib/server/tests.ts";

export const prerender = true;
export const entries = async () =>
  (await readIndex()).pages.filter((p) => p.origin === "live").map((p) => ({ slug: p.slug }));
export const GET = async ({ params }) => json(await readRequests(params.slug));
