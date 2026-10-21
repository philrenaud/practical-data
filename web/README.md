# web

The SvelteKit app (Svelte 5) for practicaldata.dev. It prerenders every route
to static files in `../site`. The Worker in `../wrangler.jsonc` serves them.
`.github/workflows/site.yml` builds the site on each pull request, and builds
and deploys it on each push to `main`.

## Commands

Run these from the repository root.

```sh
npm run web:dev      # dev server at localhost:5173; writes the demo and tests data first
npm run web:check    # svelte-check
npm run tests:data   # rewrite demo/tests/ from the recorded requests
npm run demo         # full build into site/: extension, data, this app, extension zip
```

## Routes

| Route                       | Source                                     | Data                                   |
| --------------------------- | ------------------------------------------ | -------------------------------------- |
| `/`                         | `src/routes/(site)/+page.svelte`           | `demo/data.json`, check totals         |
| `/privacy`                  | `src/routes/(site)/privacy/+page.svelte`   | none                                   |
| `/palettes`                 | `src/routes/palettes/+page.svelte`         | `demo/data.json`                       |
| `/tests`                    | `src/routes/tests/+page.svelte`            | `demo/tests/index.json`                |
| `/tests/checks/<kind>`      | `src/routes/tests/checks/[kind]/`          | index, pages; kinds in `kinds.ts`      |
| `/tests/limitations`        | `src/routes/tests/limitations/`            | index, `src/lib/tests/limitations.ts`  |
| `/tests/glossary`           | `src/routes/tests/glossary/+page.svelte`   | `src/lib/tests/glossary.ts`            |
| `/tests/sites`              | `src/routes/tests/sites/`                  | index                                  |
| `/tests/units`              | `src/routes/tests/units/`                  | index (unit results, parse examples)   |
| `/tests/requests/<slug>.json` | `src/routes/tests/requests/[slug].json/` | `demo/tests/requests/<slug>.json`      |

## How the shading works

The site does not reimplement the extension. Svelte renders each table as
plain HTML. The `shade` action in `src/lib/shade.ts` then runs the extension's
own extractor and painter from `../src/dom` on it. The judgments come from
`../demo/data.json`, which `../scripts/demo-data.ts` replays from recordings.
The site never calls a model.

## How /tests is built

`../scripts/tests-data.ts` replays the eval offline and writes `../demo/tests/`:
an index, one file per test page, and one requests file per page. The
directory is git-ignored. Run `npm run tests:data` to regenerate it. `npm run
demo` and `npm run web:dev` also run it.

`src/lib/server/tests.ts` reads these files at build time. Scoring comes from
`../scripts/lib/score.ts`, the same module that the eval uses.

The site shows only live fixtures, which are copies of real public pages.
Synthetic fixtures stay in the eval, and CI runs them, but the site hides them
because invented tables prove nothing about real ones.

## Key decisions

- **Static prerender.** The `+page.server.ts` loads run only at build time.
  The deploy is static files, with no backend to run.
- **Extension code, not a copy.** The site shades with `../src/dom`, so it
  shows what the extension does.
- **Recorded judgments.** The build needs no model key and gives the same
  output each time.
- **Requests load on demand.** A page's raw requests can be large, so each is a
  separate JSON file that `Requests.svelte` fetches when its panel opens.
- **Separate styles for `/palettes`.** It does not load `src/app.css`, so links
  to it use `data-sveltekit-reload` to load the page fresh.

## Files to keep in step

- `src/routes/(site)/privacy/+page.svelte` mirrors `../PRIVACY.md`.
- `static/icon128.png` is a copy of `../static/icon128.png`. The extension's
  static folder cannot also be the site's.

## Configuration

SvelteKit 3 takes its options through the Vite plugin, in `vite.config.ts`.
`server.fs.allow` lets the dev server read `../src` and `../demo`. `#lib/*`
imports resolve through `imports` in `package.json`.
