# practicaldata.dev

The site, as a SvelteKit app prerendered to static files in `../site`, which
the Worker in `../wrangler.jsonc` serves. Pushes to `main` deploy it
(`.github/workflows/site.yml`).

```sh
npm run web:dev      # live reload at localhost:5173
npm run web:check    # svelte-check
npm run demo         # full build into site/: extension, recorded data, this app, the extension zip
```

- **Shading is the extension's.** Tables are rendered by Svelte, then shaded
  in the browser by `shade` (`src/lib/shade.ts`), which runs the extension's
  own extractor and painter (`../src/dom`). The judgments are real ones,
  replayed from recordings into `../demo/data.json` by
  `../scripts/demo-data.ts`. Nothing on the site calls a model.
- **Routes.** `/` and `/privacy` share the site stylesheet (`src/app.css`,
  through `src/routes/(site)/+layout.svelte`). `/palettes` has its own styles,
  so links to it reload the page rather than navigating in place.
- **Tests site** (`/tests`). Built from `../demo/tests/`, which
  `../scripts/tests-data.ts` writes from an offline replay (git-ignored;
  `npm run demo` and `npm run web:dev` regenerate it). Pages read it at build
  time through `src/lib/server/tests.ts`. Check categories and their decision
  rules are in `src/lib/tests/kinds.ts`; scoring is `../scripts/lib/score.ts`,
  the same module the eval uses. Each test page's raw requests are a separate
  static `requests.json`, fetched only when opened.
- **Privacy policy.** `src/routes/(site)/privacy/+page.svelte` mirrors
  `../PRIVACY.md`; change both together.
- **`static/icon128.png`** is a copy of the extension's `../static/icon128.png`
  (the extension's static folder can't double as the site's); keep them in step.
- **Configuration** is in `vite.config.ts` (SvelteKit 3 takes its options
  through the Vite plugin). `#lib/*` imports resolve through `package.json`
  `imports`.
