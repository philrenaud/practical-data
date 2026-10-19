// Each table's requests and answers for one test page, prerendered to a static
// file and fetched only when a reader opens them.
import { json } from "@sveltejs/kit";
import { readIndex, readRequests } from "#lib/server/tests.ts";

export const prerender = true;
export const entries = async () => (await readIndex()).pages.map((p) => ({ slug: p.slug }));
export const GET = async ({ params }) => json(await readRequests(params.slug));
