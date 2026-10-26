// Builds practicaldata.dev into ../site as static files. The Worker in
// ../wrangler.jsonc serves them.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, type Plugin } from "vite";

/** Trial font files. Git-ignored; they exist only on a machine that has the trial. */
const TRIAL_FONTS = "../demo/fonts/Cambridge/OTF";

/**
 * Serves the trial fonts at /dev-fonts/ on the dev server only. A build never
 * sees them, so they cannot reach ../site or a deploy.
 */
const trialFonts = (): Plugin => ({
  name: "trial-fonts",
  apply: "serve",
  configureServer: (server) => {
    server.middlewares.use("/dev-fonts", (req, res, next) => {
      const file = basename(decodeURIComponent(req.url ?? ""));
      if (!file.endsWith(".otf")) return next();
      readFile(`${TRIAL_FONTS}/${file}`).then(
        (body) => {
          res.setHeader("Content-Type", "font/otf");
          res.end(body);
        },
        () => {
          res.statusCode = 404;
          res.end();
        },
      );
    });
  },
});

export default defineConfig({
  plugins: [
    trialFonts(),
    sveltekit({
      adapter: adapter({ pages: "../site", assets: "../site", strict: true }),
      prerender: { handleHttpError: "fail" },
    }),
  ],
  // The site imports the extension's code from ../src and the recorded judgments from ../demo.
  server: { fs: { allow: [".."] } },
});
