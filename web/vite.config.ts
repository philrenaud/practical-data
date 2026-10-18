// practicaldata.dev, prerendered to static files in ../site (served by the
// Worker in ../wrangler.jsonc).
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ pages: "../site", assets: "../site", strict: true }),
      prerender: { handleHttpError: "fail" },
    }),
  ],
  // The site imports the extension's own code (../src) and recorded judgments (../demo).
  server: { fs: { allow: [".."] } },
});
