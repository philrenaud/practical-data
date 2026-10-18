/**
 * Builds the site into site/: the SvelteKit app in web/ (prerendered), plus a
 * zip of the built extension for download and the launch videos when present.
 * Run `npm run build` and `node scripts/demo-data.ts` first.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";

// The adapter empties site/ and writes every page; extras go in afterwards.
execFileSync("npm", ["run", "build", "-w", "web"], { stdio: "inherit" });
execFileSync("zip", ["-qr", "../site/practical-data-extension.zip", "."], { cwd: "dist" });
// Launch videos, when present (rendered outside this repository), are published alongside.
await mkdir("site/media", { recursive: true });
for (const f of ["practical-data-reel.mp4", "practical-data-loop.mp4"]) await cp(`launch/stage/out/${f}`, `site/media/${f}`).catch(() => undefined);
console.log("site/ ready");
