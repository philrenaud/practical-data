/**
 * Builds the demo site into site/: the page, its bundle, and a zip of the
 * built extension for download. Run `npm run build` and `node scripts/demo-data.ts` first.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";

await rm("site", { recursive: true, force: true });
await mkdir("site", { recursive: true });
for (const f of ["demo.css", "palettes.html", "privacy.html"]) await cp(`demo/${f}`, `site/${f}`);
// The install section has two variants; config.storeUrl in package.json picks one.
const { config } = JSON.parse(await readFile("package.json", "utf8")) as { config: { storeUrl: string } };
const keep = config.storeUrl === "" ? "unpacked" : "store";
const drop = keep === "store" ? "unpacked" : "store";
const index = (await readFile("demo/index.html", "utf8"))
  .replace(new RegExp(`[ \\t]*<!--${drop}-->[\\s\\S]*?<!--/${drop}-->\\n?`, "g"), "")
  .replace(new RegExp(`<!--/?${keep}-->`, "g"), "")
  .replaceAll("{{STORE_URL}}", config.storeUrl);
await writeFile("site/index.html", index);
await cp("static/icon128.png", "site/icon128.png");
await esbuild.build({
  entryPoints: { main: "src/demo/main.ts", palettes: "src/demo/palettes.ts" },
  outdir: "site",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "none",
  logLevel: "info",
});
execFileSync("zip", ["-qr", "../site/practical-data-extension.zip", "."], { cwd: "dist" });
// Launch videos, when rendered (node scripts/video.ts), are published alongside.
await mkdir("site/media", { recursive: true });
for (const f of ["practical-data-reel.mp4", "practical-data-loop.mp4"]) await cp(`video/out/${f}`, `site/media/${f}`).catch(() => undefined);
console.log("site/ ready");
