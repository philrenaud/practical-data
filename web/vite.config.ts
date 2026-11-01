// Builds practicaldata.dev into ../site as static files. The Worker in
// ../wrangler.jsonc serves them.
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ pages: "../site", assets: "../site", strict: true }),
      prerender: {
        // The licensed Cambridge font is never in the repository: the site
        // Worker serves it from R2 (src/site/worker.ts). The prerenderer
        // crawls the preload link in app.html and 404s on it in CI, where
        // the local copy does not exist. Everything else still fails.
        handleHttpError: ({ path, message }) => {
          if (path === "/fonts/Cambridge-Light.woff2") return;
          throw new Error(message);
        },
      },
    }),
  ],
  // The site imports the extension's code from ../src and the recorded judgments from ../demo.
  server: { fs: { allow: [".."] } },
});
