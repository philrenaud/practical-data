/**
 * Builds the Chrome Web Store upload, release/practical-data-<version>.zip.
 * It refuses to run with uncommitted changes to the bundled sources or the
 * dependency lockfile, so the zip matches a commit. Two runs on one commit
 * produce byte-identical zips. Run `npm ci` first so that node_modules
 * matches the lockfile.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, utimes } from "node:fs/promises";

const BUNDLED = ["src", "static", "scripts/build.ts", "package.json", "package-lock.json"];
const dirty = execFileSync("git", ["status", "--porcelain", "--", ...BUNDLED], { encoding: "utf8" }).trim();
if (dirty !== "" && !process.argv.includes("--allow-dirty")) {
  console.error(`Uncommitted changes in ${BUNDLED.join(", ")}. Commit first, or pass --allow-dirty.`);
  process.exit(1);
}
// PD_API_ORIGIN points a build at a local endpoint and adds its host permission. A store build never does.
const { PD_API_ORIGIN: _local, ...env } = process.env;
// The store build goes into its own directory: dist/ belongs to whatever the
// owner loaded unpacked, and a store build written there would downgrade it.
execFileSync("node", ["scripts/build.ts", "--out", "dist-store"], { stdio: "inherit", env });
const { version, version_name } = JSON.parse(await readFile("dist-store/manifest.json", "utf8")) as {
  version: string;
  version_name: string;
};

// The zip records each file's mtime, so set every mtime to the commit time.
const committed = Number(execFileSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" }).trim());
// Sort the entries for a fixed order. Skip dotfiles, such as a .DS_Store that Finder wrote in.
const files = (await readdir("dist-store", { recursive: true, withFileTypes: true }))
  .filter((f) => f.isFile())
  .map((f) => `${f.parentPath}/${f.name}`.replace(/^dist-store\//, ""))
  .filter((p) => !p.split("/").some((part) => part.startsWith(".")))
  .sort();
for (const f of files) await utimes(`dist-store/${f}`, committed, committed);

// A store upload redistributes every file in it. Refuse a zip that holds a
// licensed font or any static file git does not track, whatever the reason
// it reached the build.
const trackedStatic = new Set(
  execFileSync("git", ["ls-files", "-z", "static"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((p) => p.replace(/^static\//, "")),
);
const built = new Set(["manifest.json", "background.js", "content.js", "options.js", "popup.js"]);
const forbidden = files.filter(
  (f) => /hoodfonts|cambridge|\.pdf$/i.test(f) || (!built.has(f) && !trackedStatic.has(f)),
);
if (forbidden.length > 0) {
  console.error(`Refusing to package files that do not belong in a store upload:\n  ${forbidden.join("\n  ")}`);
  process.exit(1);
}

await mkdir("release", { recursive: true });
const out = `release/practical-data-${version}.zip`;
execFileSync("rm", ["-f", out]);
// -X drops extra attributes such as owner ids. -D writes no directory entries. TZ=UTC fixes
// the DOS timestamps, which zip stores in local time.
execFileSync("zip", ["-q", "-X", "-D", `../${out}`, "-@"], {
  cwd: "dist-store",
  input: files.join("\n"),
  env: { ...env, TZ: "UTC" },
});
const sha256 = createHash("sha256")
  .update(await readFile(out))
  .digest("hex");
console.log(`${out}  (${version_name})\nsha256 ${sha256}`);
