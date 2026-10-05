/**
 * Bundles the extension into dist/. `--watch` rebuilds on change.
 * Also emits dist-probe/probe.js, an IIFE that exposes the extractor on
 * `globalThis.__practicalData` so scripts can snapshot pages with Playwright.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("static", "dist", { recursive: true, filter: (src) => !src.endsWith(".svg") });

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
const built = new Date().toISOString().slice(0, 16).replace("T", " ");
manifest["version_name"] = `${String(manifest["version"])} (${sha}${dirty}, ${built})`;
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2));

const common = {
  bundle: true,
  target: "chrome120",
  logLevel: "info",
  legalComments: "none",
  // Unminified: Web Store reviewers (and anyone auditing a key-handling extension) can read it.
  minify: false,
  sourcemap: watch ? "inline" : false,
} as const satisfies esbuild.BuildOptions;

const builds: esbuild.BuildOptions[] = [
  { ...common, entryPoints: { content: "src/ext/content.ts" }, outdir: "dist", format: "iife" },
  { ...common, entryPoints: { background: "src/ext/background.ts", options: "src/ext/options.ts", popup: "src/ext/popup.ts" }, outdir: "dist", format: "esm" },
  {
    ...common,
    entryPoints: { probe: "src/dom/probe.ts" },
    outdir: "dist-probe",
    format: "iife",
    minify: false,
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
