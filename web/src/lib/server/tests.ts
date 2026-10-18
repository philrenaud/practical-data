/**
 * Reads the tests site's data at build time (prerender). The files come from
 * scripts/tests-data.ts; `npm run demo` and `npm run web:dev` write them first.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { error } from "@sveltejs/kit";
import type { PageRequests, TestPage, TestsIndex } from "../tests/types.ts";

// Vite runs from web/, so the repository root is one level up.
const DATA = resolve(process.cwd(), "..", "demo", "tests");

const read = async <T>(path: string): Promise<T> => {
  try {
    return JSON.parse(await readFile(resolve(DATA, path), "utf8")) as T;
  } catch {
    error(500, `Missing ${path} in demo/tests/: run \`node scripts/tests-data.ts\`.`);
  }
};

let index: Promise<TestsIndex> | undefined;
export const readIndex = (): Promise<TestsIndex> => (index ??= read<TestsIndex>("index.json"));
export const readPage = (slug: string): Promise<TestPage> =>
  /^[a-z0-9-]+$/.test(slug) ? read<TestPage>(`pages/${slug}.json`) : error(404, "No such page");
export const readRequests = (slug: string): Promise<PageRequests> =>
  /^[a-z0-9-]+$/.test(slug) ? read<PageRequests>(`requests/${slug}.json`) : error(404, "No such page");
