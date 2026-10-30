/**
 * Builds the site into site/. The site is the prerendered SvelteKit app in
 * web/, a zip of the built extension, and the launch videos if they exist.
 * Run it through `npm run demo`, which first runs the build, demo-data, and
 * tests-data steps.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";

// The SvelteKit adapter empties site/, so the zip and the videos go in after it runs.
execFileSync("npm", ["run", "build", "-w", "web"], { stdio: "inherit" });
execFileSync("zip", ["-qr", "../site/practical-data-extension.zip", ".", "-x", ".*", "*/.*"], { cwd: "dist-store" });
// The launch videos are rendered outside this repository. Copy them only if they exist.
await mkdir("site/media", { recursive: true });
for (const f of ["practical-data-reel.mp4", "practical-data-loop.mp4"])
  await cp(`launch/stage/out/${f}`, `site/media/${f}`).catch(() => undefined);
console.log("site/ ready");
