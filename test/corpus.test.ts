import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkCase, readProbeFile } from "../scripts/probe-parse.ts";

for (const c of readProbeFile(fileURLToPath(new URL("./probe-corpus.jsonl", import.meta.url)))) {
  test(`corpus: ${c.cell}${c.lang === undefined ? "" : ` [${c.lang}]`}`, () => {
    assert.equal(checkCase(c), null);
  });
}
