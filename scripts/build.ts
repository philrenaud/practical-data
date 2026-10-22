/**
 * Bundles the extension into dist/. `--watch` rebuilds on change. `--dev`
 * builds the field-test copy: it files flags to FLAGS_REPO (src/ext/flags.ts)
 * and needs extra permissions. Never upload a `--dev` build to the store.
 * Also emits dist-probe/probe.js, an IIFE that exposes the extractor on
 * `globalThis.__practicalData` so scripts can snapshot pages with Playwright.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const dev = process.argv.includes("--dev");
const FLAGS_REPO = "philrenaud/practical-data-flags";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
// Skip dotfiles, such as Finder's .DS_Store, and the SVG icon source.
await cp("static", "dist", {
  recursive: true,
  filter: (src) => !basename(src).startsWith(".") && !src.endsWith(".svg"),
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
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8")) as Record<string, unknown>;
// A clean build takes its time from the commit, so two builds of one commit are identical.
// A build with local changes takes the current time.
const committed = Number(git("log", "-1", "--format=%ct"));
const stamp = dirty === "" && committed > 0 ? new Date(committed * 1000) : new Date();
const built = stamp.toISOString().slice(0, 16).replace("T", " ");
manifest["version_name"] = `${String(manifest["version"])} (${sha}${dirty}, ${built})`;
// A local endpoint needs its own host permission, as api.practicaldata.dev has in the manifest.
const apiOrigin = process.env["PD_API_ORIGIN"];
if (apiOrigin !== undefined) (manifest["host_permissions"] as string[]).push(`${apiOrigin}/*`);
if (dev) {
  manifest["name"] = `${String(manifest["name"])} (dev)`;
  // A flag needs a menu item, a screenshot of any tab, and the GitHub API.
  (manifest["permissions"] as string[]).push("contextMenus");
  (manifest["host_permissions"] as string[]).push("<all_urls>");
}
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2));

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
  { ...common, entryPoints: { content: "src/ext/content.ts" }, outdir: "dist", format: "iife" },
  {
    ...common,
    entryPoints: { background: "src/ext/background.ts", options: "src/ext/options.ts", popup: "src/ext/popup.ts" },
    outdir: "dist",
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
