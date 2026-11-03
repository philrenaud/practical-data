/**
 * Runs probe cases against the parser: cell text paired with the reading a
 * person expects. A case fails when parseNumber disagrees with the
 * expectation. The checked-in corpus (test/probe-corpus.jsonl) runs in
 * npm test; this script runs it, or any probe file, from the command line:
 *
 *   node scripts/probe-parse.ts                 # the corpus
 *   node scripts/probe-parse.ts cases.jsonl     # a probe run's cases
 *
 * Exits 1 when any case disagrees.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conventionForLang, parseNumber } from "../src/core/parse.ts";

export interface ProbeCase {
  /** The cell text as a page would write it. */
  readonly cell: string;
  /** The page's language subtag ("de"). Missing means dot-decimal. */
  readonly lang?: string;
  /** The reading a person expects. Null means the cell must stay text. */
  readonly expect: {
    readonly value: number;
    /** Checked only when present. Null asserts no unit. */
    readonly unit?: string | null;
    readonly bound?: boolean;
    readonly range?: readonly [number, number];
  } | null;
  /** Why the expectation is right. */
  readonly note?: string;
}

/** Returns a description of the disagreement, or null when the parser agrees. */
export const checkCase = (c: ProbeCase): string | null => {
  const got = parseNumber(c.cell, conventionForLang(c.lang));
  if (c.expect === null) {
    return got === null ? null : `parsed ${got.value}${got.unit === null ? "" : ` ${got.unit}`}, expected text`;
  }
  if (got === null) return `stayed text, expected ${c.expect.value}`;
  if (got.value !== c.expect.value) return `value ${got.value}, expected ${c.expect.value}`;
  if (c.expect.unit !== undefined && got.unit !== c.expect.unit) {
    return `unit ${JSON.stringify(got.unit)}, expected ${JSON.stringify(c.expect.unit)}`;
  }
  if (c.expect.bound !== undefined && got.bound !== c.expect.bound) {
    return `bound ${got.bound}, expected ${c.expect.bound}`;
  }
  if (c.expect.range !== undefined) {
    if (got.range === null) return `no range, expected [${c.expect.range.join(", ")}]`;
    if (got.range[0] !== c.expect.range[0] || got.range[1] !== c.expect.range[1]) {
      return `range [${got.range.join(", ")}], expected [${c.expect.range.join(", ")}]`;
    }
  }
  return null;
};

/** Parses one probe file: one JSON case per line, blank lines skipped. */
export const readProbeFile = (path: string): readonly ProbeCase[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ProbeCase);

const main = (): void => {
  const files = process.argv.slice(2);
  if (files.length === 0) files.push(fileURLToPath(new URL("../test/probe-corpus.jsonl", import.meta.url)));
  let cases = 0;
  let failures = 0;
  for (const file of files) {
    for (const c of readProbeFile(file)) {
      cases += 1;
      const disagreement = checkCase(c);
      if (disagreement === null) continue;
      failures += 1;
      const where = c.lang === undefined ? "" : ` [lang=${c.lang}]`;
      const why = c.note === undefined ? "" : ` — ${c.note}`;
      console.log(`✗ ${JSON.stringify(c.cell)}${where}: ${disagreement}${why}`);
    }
  }
  console.log(`${cases} cases, ${failures} disagreement${failures === 1 ? "" : "s"}`);
  process.exitCode = failures === 0 ? 0 : 1;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
