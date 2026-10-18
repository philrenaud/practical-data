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
- **Privacy policy.** `src/routes/(site)/privacy/+page.svelte` mirrors
  `../PRIVACY.md`; change both together.
- **Configuration** is in `vite.config.ts` (SvelteKit 3 takes its options
  through the Vite plugin). `#lib/*` imports resolve through `package.json`
  `imports`.
