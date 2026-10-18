/**
 * Bundles the Google Sheets add-on into dist-sheets/: Code.js and the
 * appsscript.json manifest, ready to paste into a sheet's Apps Script editor
 * or push with clasp. PD_API_ORIGIN points it at another endpoint.
 *
 * Apps Script finds menu handlers and triggers by top-level function name, so
 * the bundle is wrapped as `PracticalData` and each entry point gets a stub.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";
import { PALETTES } from "../src/core/palettes.ts";

const origin = process.env["PD_API_ORIGIN"] ?? "https://api.practicaldata.dev";
await rm("dist-sheets", { recursive: true, force: true });
await mkdir("dist-sheets", { recursive: true });

await esbuild.build({
  entryPoints: ["src/sheets/addon.ts"],
  outfile: "dist-sheets/bundle.js",
  bundle: true,
  format: "iife",
  globalName: "PracticalData",
  // Apps Script's V8 runtime; newer syntax is lowered, newer library methods are not.
  target: "es2019",
  legalComments: "none",
  minify: false,
  logLevel: "info",
  define: { PD_API_ORIGIN: JSON.stringify(origin) },
});

const stubs = [
  "function onOpen(e) { PracticalData.onOpen(e); }",
  "function onInstall(e) { PracticalData.onInstall(e); }",
  "function shadeTable() { PracticalData.shadeTable(); }",
  "function removeShading() { PracticalData.removeShading(); }",
  ...Object.keys(PALETTES).map((id) => `function palette_${id}() { PracticalData.setPalette(${JSON.stringify(id)}); }`),
];
const polyfill = `if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", { value: function (i) { i = Math.trunc(i) || 0; return this[i < 0 ? this.length + i : i]; } });
}`;
await writeFile(
  "dist-sheets/Code.js",
  `// Practical Data for Google Sheets. Built from src/sheets/ by scripts/build-sheets.ts.\n${polyfill}\n${stubs.join("\n")}\n\n${await readFile("dist-sheets/bundle.js", "utf8")}`,
);
await rm("dist-sheets/bundle.js");

await writeFile(
  "dist-sheets/appsscript.json",
  JSON.stringify(
    {
      timeZone: "Etc/UTC",
      runtimeVersion: "V8",
      exceptionLogging: "STACKDRIVER",
      oauthScopes: [
        "https://www.googleapis.com/auth/spreadsheets.currentonly",
        "https://www.googleapis.com/auth/script.container.ui",
        "https://www.googleapis.com/auth/script.external_request",
      ],
      urlFetchWhitelist: [`${origin}/`],
    },
    null,
    2,
  ),
);
