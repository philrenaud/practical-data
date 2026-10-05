/**
 * Builds the Chrome Web Store upload: release/practical-data-<version>.zip.
 * Refuses a dirty tree, so the zip always matches a commit (its version_name
 * carries that commit's sha).
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";

const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "static", "scripts/build.ts"], { encoding: "utf8" }).trim();
if (dirty !== "" && !process.argv.includes("--allow-dirty")) {
  console.error("Uncommitted changes in src/, static/ or the build script; commit first (or pass --allow-dirty).");
  process.exit(1);
}
execFileSync("node", ["scripts/build.ts"], { stdio: "inherit" });
const { version, version_name } = JSON.parse(await readFile("dist/manifest.json", "utf8")) as { version: string; version_name: string };
await mkdir("release", { recursive: true });
const out = `release/practical-data-${version}.zip`;
execFileSync("rm", ["-f", out]);
execFileSync("zip", ["-qr", `../${out}`, "."], { cwd: "dist" });
console.log(`${out}  (${version_name})`);
