/**
 * Builds the Chrome Web Store upload, release/practical-data-<version>.zip.
 * It refuses to run with uncommitted changes to the bundled sources or the
 * dependency lockfile, so the zip matches a commit. The manifest's
 * version_name carries that commit's short SHA. Run `npm ci` first so that
 * node_modules matches the lockfile.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";

const BUNDLED = ["src", "static", "scripts/build.ts", "package.json", "package-lock.json"];
const dirty = execFileSync("git", ["status", "--porcelain", "--", ...BUNDLED], { encoding: "utf8" }).trim();
if (dirty !== "" && !process.argv.includes("--allow-dirty")) {
  console.error(`Uncommitted changes in ${BUNDLED.join(", ")}. Commit first, or pass --allow-dirty.`);
  process.exit(1);
}
// PD_API_ORIGIN points a build at a local endpoint and adds its host permission. A store build never does.
const { PD_API_ORIGIN: _local, ...env } = process.env;
execFileSync("node", ["scripts/build.ts"], { stdio: "inherit", env });
const { version, version_name } = JSON.parse(await readFile("dist/manifest.json", "utf8")) as {
  version: string;
  version_name: string;
};
await mkdir("release", { recursive: true });
const out = `release/practical-data-${version}.zip`;
execFileSync("rm", ["-f", out]);
// Finder can write .DS_Store into dist/ after the build, so the zip excludes dotfiles too.
execFileSync("zip", ["-qr", `../${out}`, ".", "-x", ".*", "*/.*"], { cwd: "dist" });
console.log(`${out}  (${version_name})`);
