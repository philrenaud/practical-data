/**
 * Deletes recordings in fixtures/recordings/ that no replay asks for anymore.
 *
 * A recording is keyed by the SHA-256 of its request body, so it goes stale
 * when anything in that body changes: the snapshot, the question wording,
 * the request shape. Recording never deletes, so stale files accumulate.
 *
 *   node scripts/prune-recordings.ts            # prune
 *   node scripts/prune-recordings.ts --dry-run  # only report
 *
 * The live set is what the offline entrypoints read. This script rebuilds
 * dist/, then runs the eval, the demo data, the tests-site data, and the
 * offline e2e with RECORDINGS_LOG set (scripts/lib/cache.ts), and deletes
 * every recording whose key none of them asked for. A key that only an
 * ad-hoc run recorded (explain-url.ts, api-smoke.ts) is deleted and records
 * again on that script's next run with an API key.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

const RECORDINGS = "fixtures/recordings";
const log = join(await mkdtemp(join(tmpdir(), "prune-recordings-")), "keys.log");
// An empty key keeps a missing recording a loud failure instead of a live call.
const env = { ...process.env, RECORDINGS_LOG: log, TYPESAFE_API_KEY: "" };

const runs: readonly (readonly [string, readonly string[]])[] = [
  ["npm", ["run", "build"]],
  ["node", ["scripts/eval.ts", "--offline"]],
  ["node", ["scripts/demo-data.ts"]],
  ["node", ["scripts/tests-data.ts"]],
  ["node", ["scripts/e2e.ts", "--offline"]],
];
for (const [cmd, cmdArgs] of runs) {
  console.log(`\n> ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, [...cmdArgs], { env, stdio: "inherit" });
}

const live = new Set((await readFile(log, "utf8")).split("\n").filter((k) => k !== ""));
const files = (await readdir(RECORDINGS)).filter((f) => f.endsWith(".json"));
const stale = files.filter((f) => !live.has(f.slice(0, -".json".length)));
if (!args["dry-run"]) for (const f of stale) await rm(join(RECORDINGS, f));
console.log(
  `\n${files.length} recordings, ${live.size} live keys, ${stale.length} stale${args["dry-run"] ? " (kept: dry run)" : " deleted"}`,
);
