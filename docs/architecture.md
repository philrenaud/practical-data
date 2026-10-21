# Architecture

This page follows one table from the web page to the model and back to the
page. The folder READMEs have the details for each step.

## Where code runs

| Context | Entry point | Code it uses | What it does |
| --- | --- | --- | --- |
| Content script, on every `http` and `https` page | `src/ext/content.ts` | `src/dom`, parts of `src/core` | Finds tables near the viewport, reads them, paints the result, and shows the per-table controls |
| Service worker | `src/ext/background.ts` | `src/decide`, `src/core` | Reads settings and keys, runs the judge, calls the provider, and caches answers |
| Popup and options pages | `src/ext/popup.ts`, `src/ext/options.ts` | `src/ext/settings.ts` | Show status and change settings |
| Cloudflare Worker at `api.practicaldata.dev` | `src/api/worker.ts` | `src/decide`, `src/core` | The free provider: checks requests, answers from a shared cache, and forwards the rest to TypeSafe |
| Site at practicaldata.dev | `web/` | `src/dom` | Paints recorded judgments on corpus tables. It makes no model calls |

## From page to paint

1. **Find.** `content.ts` watches each table with an `IntersectionObserver`.
   A table counts as near when it is within one viewport height of the
   screen. The script stops at 200 tables on a page. A `MutationObserver`
   and a `ResizeObserver` start a new pass when a table appears, changes, or
   expands.
2. **Extract.** `extractPage` in `src/dom/extract.ts` turns each near table
   into a `TableSnapshot`. It resolves `rowspan` and `colspan` into a
   rectangular grid of cell text. Snapshots are plain JSON
   (`src/core/types.ts`), so they can cross the message boundary. The
   content script sends every snapshot it has seen to the service worker,
   with any orientation the user chose. Tables that the user hid are not
   sent.
3. **Profile.** `judgePage` in `src/decide/judge.ts` calls `profileTable`
   in `src/core/profile.ts` for each table. Code parses numbers, dates, and
   labels (`src/core/parse.ts`, `src/core/dates.ts`). It computes extents,
   spread, and hints such as `isSequence`. Each column becomes numeric, a
   short set of labels, or text. Date columns get a scale here, with no
   model request.
4. **Ask.** `src/decide/questions.ts` builds the questions. Each table gets
   one request about its numeric columns and its first and last two rows.
   Each label column gets its own request, and a second one for pairwise
   order if the labels look ordered. Each page gets one more request about
   shared scales. The model receives facts as words, not raw arithmetic.
5. **Send.** `src/decide/model.ts` is the provider boundary. It splits a
   request into chunks of at most the provider's question limit and hashes
   each chunk. It returns a cached answer if one is valid. Otherwise it
   sends the chunk through one of three transports, `hosted`, `jev`, or
   `clef`. It retries transient errors up to four times with backoff, then
   checks that every answer matches its question.
6. **Free endpoint.** For the `hosted` transport, `src/api/worker.ts`
   refuses web-page origins and malformed install ids, and applies rate
   limits. `src/api/allow.ts` refuses any question the extension's own
   builders would not make. The Worker then checks the shared cache,
   reserves from the daily allowance (`src/api/quota.ts`), forwards to
   TypeSafe, and validates the answer before it caches it.
7. **Decide.** `judge.ts` applies the thresholds in `DEFAULT_POLICY` to the
   probabilities. A column is shaded only at 0.7 or more. The result is a
   `ColumnEncoding` for each shaded column: kind, direction, scale, and
   domain. Columns that share a scale get a merged domain. Ordinals with two
   levels are dropped.
8. **Paint.** The service worker returns a `PageJudgment` and the palette.
   `paintTable` in `src/dom/paint.ts` maps each value to a color with
   `src/core/scale.ts`. It blends the color over the row's real background
   (`src/dom/color.ts` resolves any CSS color) and keeps text contrast at
   5:1 or more (`src/core/tint.ts`). It saves each cell's original inline
   style, so `unpaint` restores the page. The hover card and the table
   controls (`src/dom/controls.ts`) live in shadow roots.

## What is cached where

| Cache | Location | Key | Lifetime |
| --- | --- | --- | --- |
| Model answers | `chrome.storage.local`, prefix `answers:v2:` | SHA-256 of the request body | Up to 1,500 entries. The oldest 300 go when the cap is passed. Cleared from the options page |
| Shared answers | Cloudflare cache, per data centre | SHA-256 of the forwarded request | 30 days |
| Daily counts | One Durable Object per UTC day | Install id, and a total | Deleted two days later |
| Paused pages, per-table choices | `chrome.storage.session` | Page URL without the fragment | The browser session |
| Settings, key, install id | `chrome.storage.local` | Fixed keys | Until changed or uninstalled |
| Recorded answers for tests | `fixtures/recordings/` | SHA-256 of the request body | Committed |
| Last painted snapshot | Content script memory | The snapshot text | The page. An unchanged, intact table is not sent again |

A changed question has a new hash. Old answers therefore never answer new
questions. Cached answers are validated again when they are read.

## Main decisions

- **Code computes, the model judges meaning.** Jev is weak at arithmetic and
  counting, so code owns every number.
- **Only the service worker reads keys.** The content script shares the
  page's DOM, so it never reads settings. Web pages cannot reach the service
  worker or extension storage.
- **Only near tables are sent.** This keeps cost low and sends nothing for
  parts of a page that you never see.
- **Answers are cached by request hash.** An unchanged table costs nothing
  on a second visit.
- **The allowlist is built from the question builders.** The free endpoint
  cannot be used as a general model, and a wording change updates the
  extension and the allowlist in one commit.
- **One Durable Object per UTC day.** Counts reset without a cleanup job.
- **The build is not minified.** Store reviewers and users can read the
  shipped code.
- **Painting is reversible.** Turning shading off restores the page's
  original markup and inline styles.
- **Effect at the provider boundary.** Typed errors, retries, and the cache
  are services that tests can replace with a scripted model.

## Folder READMEs

- [src/dom/README.md](../src/dom/README.md)
- [src/core/README.md](../src/core/README.md)
- [src/decide/README.md](../src/decide/README.md)
- [src/ext/README.md](../src/ext/README.md)
- [src/api/README.md](../src/api/README.md)
- [scripts/README.md](../scripts/README.md)
- [test/README.md](../test/README.md)
- [web/README.md](../web/README.md)
