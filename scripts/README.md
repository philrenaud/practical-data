# Scripts

The scripts in this directory build, test, and package the extension, and
build the data for the site. Node runs them as TypeScript, with no compile
step. Run them from the repository root, because they use paths relative to
it.

Scripts that open a browser use Playwright's Chromium. Install it once with
`npx playwright install chromium`.

## Scripts

Most scripts run offline. A script that calls the decision model needs
`TYPESAFE_API_KEY`, but only for questions that have no recorded answer in
`fixtures/recordings/`.

| Script | npm script | What it does | Network or key |
| --- | --- | --- | --- |
| `build.ts` | `build`, `dev` | Bundles `src/` and copies `static/` into `dist/`. Also writes `dist-probe/probe.js`, which exposes the extractor to Playwright. `--watch` rebuilds on change. | None |
| `package.ts` | `package` | Builds `release/practical-data-<version>.zip` for the Chrome Web Store. | None |
| `snapshot.ts` | `snapshot` | Runs the extractor on every fixture page and writes `fixtures/snapshots/<slug>.json`. Needs `npm run build` first. | None. It blocks all outside requests. |
| `eval.ts` | `eval` | Judges every snapshot and scores the result against `fixtures/expectations.json`. Writes `artifacts/eval-<provider>.json`. | Key for unrecorded questions. None with `--offline`. |
| `e2e.ts` | `e2e` | Loads `dist/` as an unpacked extension, opens every fixture page, and checks the painted result. Needs `npm run build` first. Writes `artifacts/e2e.json` and `artifacts/screens/`. | Key, unless `--offline`. `--live` also visits the real sites. |
| `api-smoke.ts` | `api:smoke` | Runs the free endpoint in `api/` under `wrangler dev`, against a local stand-in for the TypeSafe API, and checks its responses. | None. `npx` downloads wrangler on first use. |
| `demo-data.ts` | `demo:data` | Trims tables from the snapshots and judges them for the site. Writes `demo/data.json`. | Key for unrecorded questions |
| `tests-data.ts` | `tests:data` | Writes the data for the `/tests` site into `demo/tests/`: every eval check, the request and answer behind it, and the unit test results. Fails on any request with no recording. | None |
| `build-demo.ts` | part of `demo` | Builds the SvelteKit site in `web/` into `site/`, with a zip of `dist/`. | None |
| `serve.ts` | none | A static file server and the list of fixture pages. The other scripts import it. | None |
| `explain-url.ts` | none | Prints the decision and the reason for every column on any URL. | Fetches the page. Key for unrecorded questions. |
| `readme-media.ts` | none | Renders the README images in `docs/media/` from `docs/media-src/cards.html`. | Key for unrecorded questions |
| `shoot-demo.ts` | none | Screenshots `site/` at desktop and phone widths in light and dark, and reports page errors and horizontal overflow. | None, unless you pass a URL |
| `shoot-options.ts` | none | Screenshots the options page in light and dark. Needs `npm run build` first. | None |
| `shoot-interactions.ts` | none | Screenshots the legend hover card and the options page Test button. | Key |
| `save-rendered.ts` | none | Saves a page's DOM after its scripts run, for a new fixture whose tables are built in the browser. | Fetches the page |
| `strip-fixture.ts` | none | Reduces saved pages in `fixtures/live/` to their title, headings, and tables, and adds the attribution comment. | None |
| `icons.ts` | none | Renders `static/icon.svg` to the PNG icons. The PNGs are committed. | None |
| `lib/score.ts` | none | The scoring that the eval and the tests site share. | None |
| `lib/cache.ts` | none | Reads and writes `fixtures/recordings/`. | None |
| `probes/*.ts` | none | One-off experiments that compared question designs. `docs/decisions.md` records the results. | Key. Probes always call the model. |

`npm run check` runs every offline gate in order: `format:check`,
`typecheck`, `test`, `build`, `eval -- --offline --strict`, and
`e2e -- --offline`. CI (`.github/workflows/site.yml`) runs the same gates
except the e2e, which needs a browser that can load an extension.

## Fixtures

Each fixture page has a slug, which is its file name without `.html`. Every
other file for that page uses the same slug.

- `fixtures/live/` holds excerpts of real pages. `sources.json` lists each
  page's URL, and `fixtures/NOTICE.md` lists its rights.
- `fixtures/synthetic/` holds handmade pages for cases that real pages do not
  cover. Examples are numeric identifiers, a totals row, a dark theme, collapsed
  tables, and a page that opts out.
- `fixtures/snapshots/` holds what the extractor returns for each page. The
  eval judges these snapshots, not the HTML. Rerun `npm run snapshot` after you
  change `src/dom/`.
- `fixtures/recordings/` holds recorded model answers, one file per request.
- `fixtures/expectations.json` holds the hand labels.

To add a live page, save it with `node scripts/save-rendered.ts <url> <slug>`
or from the browser. Then run `node scripts/strip-fixture.ts <slug>`, add the
page to `sources.json` and `NOTICE.md`, and run `npm run snapshot`.

## How the eval scores

`expectations.json` maps a page slug to a table id to a column header. A
column's label is `"none"`, which means the column must stay plain, or a spec
with a `kind` and optional `polarity`, `transform`, and `order`. A table can
also list `aggregateRows` and an `@orientation`, and a page can list `shared`
groups of columns that must use one scale. The eval does not score columns
that have no label.

`lib/score.ts` turns each label into checks of seven kinds: detection,
polarity, transform, ordinal order, aggregate rows, shared scales, and
orientation. A check of a detail runs only if the column was detected as the
right kind, so one wrong detection counts once.

`expectations.$known` lists failures that are understood and documented. Each
key is the start of a failure message. With `--strict`, the eval fails on any
mismatch that `$known` does not list. The tests site shows the `$known` reason
next to each such failure.

The labels and the model's thresholds were tuned on these same pages. A
passing eval shows that known-good behavior did not break. It is not an
accuracy estimate for pages the extension has not seen.

## How recordings make runs repeatable

The key of a recording is the SHA-256 of the request body, which holds the
model name, the state, and the questions. The extension's own answer cache
uses the same key. A changed question or state produces a new key, so a stale
answer never replays.

- `eval`, `demo-data`, `explain-url`, and `readme-media` replay a recording if
  one exists. Otherwise, they call the model and write a new recording.
- `eval -- --offline`, `tests-data`, and `test/allow.test.ts` replace `fetch`
  with a function that fails. A request with no recording fails the run.
- `e2e` intercepts the extension's requests to `api.typesafe.ai`. With
  `--offline`, it answers them from the recordings. Without it, it calls the
  API for every request and writes each answer over its recording.
- `e2e -- --offline` reports missing recordings but does not fail on them.
  Lazy judging sends share requests for sets of tables that the eval never
  sends.

Offline replay tests the code against fixed answers. It cannot detect drift
in the model. An online `npm run eval` does not detect drift either, because
it replays every answer that is already recorded. To measure the current
model, move `fixtures/recordings/` aside and run `npm run eval`. Then compare
the scores and the new recordings with the old ones.

## How the store zip is built

`npm run package` runs `package.ts`, which does the following:

1. It refuses to run if `src/`, `static/`, `scripts/build.ts`,
   `package.json`, or `package-lock.json` has uncommitted changes.
   `--allow-dirty` skips this check.
2. It runs `build.ts` without `PD_API_ORIGIN`, so the build always targets
   the production endpoint.
3. It sets the mtime of every file in `dist/` to the commit time.
4. It zips a sorted list of the files, without dotfiles, into
   `release/practical-data-<version>.zip`. It uses `zip -X -D` with
   `TZ=UTC`, so the zip holds no owner ids, no directory entries, and no
   local time zone.
5. It prints the zip's SHA-256.

`build.ts` sets the manifest's `version_name` to the version, the short
commit SHA, and the commit time in UTC, for example
`1.1.0 (475b7e9, 2026-10-21 03:24)`. The popup and the options page show it
as the Build line. If `src/` or `static/` has uncommitted changes, the build
appends `+dev` and uses the current time instead. Run `npm ci` before you
package, so that `node_modules` matches the lockfile.

### Verify a store build

Two packages of one commit are byte-identical. To check that a store build
matches the source, do these steps:

1. In the extension's popup, read the commit SHA from the Build line.
2. Check out that commit in a clean clone, and run `npm ci`.
3. Run `npm run package`, and note the SHA-256 that it prints.
4. Compare that SHA-256 with `shasum -a 256` of the zip that you want to
   verify.

The Web Store repackages uploads, so a copy installed from the store does
not match the zip byte for byte. To check an installed copy, compare its
files with the build output. Find the installed copy under the Chrome
profile's `Extensions/<extension id>/<version>/` directory, then run
`diff -r dist/ <that directory>`. Expect differences only in the store's
`_metadata/` directory and in `manifest.json`, where the store adds fields
such as `key` and `update_url`.

The checksum can differ between machines if `zip` writes different file
permissions. The file contents in `dist/` do not differ.

## Decisions

- The bundle is not minified, so a Web Store reviewer or a user can read the
  code that handles their API key.
- The eval judges snapshots, not live pages, so a site redesign cannot change
  a score.
- `snapshot.ts`, and `e2e.ts` without `--live`, block outside requests, so a
  fixture renders from its saved HTML alone.
- The eval, the tests site, and the unit tests share one set of recordings,
  so they all see the same answers.
- `lib/score.ts` is the only scoring code, so the eval and the tests site
  cannot report different results.
- The probes stay in the repository because `docs/decisions.md` cites their
  results.
