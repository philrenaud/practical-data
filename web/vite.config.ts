// Builds practicaldata.dev into ../site as static files. The Worker in
// ../wrangler.jsonc serves them.
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
  // The site imports the extension's code from ../src and the recorded judgments from ../demo.
  server: { fs: { allow: [".."] } },
});
