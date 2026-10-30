/**
 * Bundles the extension into dist/, or into the directory `--out` names.
 * `--watch` rebuilds on change. `--dev` builds the field-test copy: it files
 * flags to FLAGS_REPO (src/ext/flags.ts) and needs extra permissions. Never
 * upload a `--dev` build to the store. Test scripts build into dist-e2e/
 * (scripts/serve.ts), so dist/ stays whatever the owner loaded unpacked.
 * Also emits dist-probe/probe.js, an IIFE that exposes the extractor on
 * `globalThis.__practicalData` so scripts can snapshot pages with Playwright.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const dev = process.argv.includes("--dev");
const outArg = process.argv.indexOf("--out");
const out = outArg === -1 ? "dist" : process.argv[outArg + 1];
if (out === undefined) throw new Error("--out needs a directory");
const FLAGS_REPO = "philrenaud/practical-data-flags";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
// Copy only the files that git tracks in static/. The directory also holds
// git-ignored local files, such as the licensed Hoodzpah fonts for the
// website, whose EULA forbids redistribution; no untracked file belongs in a
// build. Dotfiles, such as Finder's .DS_Store, and the SVG icon source stay
// out even when tracked. Without git, only the known licensed names are
// skipped.
const tracked = (() => {
  try {
    return new Set(execFileSync("git", ["ls-files", "-z", "static"], { encoding: "utf8" }).split("\0").filter(Boolean));
  } catch {
    return null;
  }
})();
await cp("static", out, {
  recursive: true,
  filter: (src) => {
    if (basename(src).startsWith(".") || src.endsWith(".svg")) return false;
    if (tracked === null) return !/hoodfonts|cambridge/i.test(src);
    // Directories pass so cp descends; their files are filtered one by one.
    const rel = relative("static", src);
    return rel === "" || statSync(src).isDirectory() || tracked.has(`static/${rel}`);
  },
});

// Stamp the build so a stale unpacked copy is obvious in chrome://extensions.
const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const sha = git("rev-parse", "--short", "HEAD") || "nogit";
const dirty = git("status", "--porcelain", "--", "src", "static") === "" ? "" : "+dev";
const manifest = JSON.parse(await readFile(`${out}/manifest.json`, "utf8")) as Record<string, unknown>;
// A clean build takes its time from the commit, so two builds of one commit are identical.
// A build with local changes takes the current time.
const committed = Number(git("log", "-1", "--format=%ct"));
const stamp = dirty === "" && committed > 0 ? new Date(committed * 1000) : new Date();
// Seconds, so that a rebuild within the same minute still changes the stamp,
// which the dev build's self-reload check compares.
const built = stamp.toISOString().slice(0, 19).replace("T", " ");
manifest["version_name"] = `${String(manifest["version"])} (${sha}${dirty}, ${built})`;
// A local endpoint needs its own host permission, as api.practicaldata.dev has in the manifest.
const apiOrigin = process.env["PD_API_ORIGIN"];
if (apiOrigin !== undefined) (manifest["host_permissions"] as string[]).push(`${apiOrigin}/*`);
if (dev) {
  manifest["name"] = `${String(manifest["name"])} (dev)`;
  // A flag needs a menu item, a screenshot of any tab, and the GitHub API.
  // The self-reload check (src/ext/background.ts) needs an alarm.
  (manifest["permissions"] as string[]).push("contextMenus", "alarms");
  (manifest["host_permissions"] as string[]).push("<all_urls>");
}
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));

const define: Record<string, string> = {};
// PD_API_ORIGIN=http://localhost:8787 points the free provider at a local `wrangler dev`.
if (apiOrigin !== undefined) define["PD_API_ORIGIN"] = JSON.stringify(apiOrigin);
// The store build defines it as null, and the bundler drops the flag code.
define["PD_FLAGS_REPO"] = dev ? JSON.stringify(FLAGS_REPO) : "null";

const common = {
  bundle: true,
  target: "chrome120",
  logLevel: "info",
  legalComments: "none",
  // The bundle is not minified, so Web Store reviewers and anyone who audits the extension can read it.
  minify: false,
  sourcemap: watch ? "inline" : false,
  define,
} as const satisfies esbuild.BuildOptions;

const builds: esbuild.BuildOptions[] = [
  { ...common, entryPoints: { content: "src/ext/content.ts" }, outdir: out, format: "iife" },
  {
    ...common,
    entryPoints: { background: "src/ext/background.ts", options: "src/ext/options.ts", popup: "src/ext/popup.ts" },
    outdir: out,
    format: "esm",
  },
  {
    ...common,
    entryPoints: { probe: "src/dom/probe.ts" },
    outdir: "dist-probe",
    format: "iife",
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
