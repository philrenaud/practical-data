# src/dom

Code that touches a live page: it reads tables into text, and it paints and
unpaints judgments. The content script (`src/ext/content.ts`) and the demo
site (`web/src/lib/shade.ts`) both use it. The math is in `src/core`.

## Files

| File | What it has |
| --- | --- |
| `extract.ts` | `extractPage` and `extractTable` (DOM to `TableSnapshot`), `transposeExtracted` |
| `paint.ts` | `paintTable` and `unpaint`. The header gradient bar and the hover card |
| `controls.ts` | `attachControls` and `detachControls`: the Columns, Rows, and Hide shading bar |
| `color.ts` | `resolveColor`: any CSS color to sRGB and alpha |
| `probe.ts` | A test-only bundle (`dist-probe/probe.js`) that exposes `extractPage` to Playwright |

`src/demo/media.ts` is a second Playwright bundle for
`scripts/readme-media.ts`. It exposes `extractPage` and `paintTable` to
render the README images.

## Data flow

1. `extractPage(document, include)` returns every `<table>` and an
   `ExtractedTable` for each one `include` accepts. An `ExtractedTable` is a
   `TableSnapshot` plus a grid of the cell elements (`cells`) and the header
   cell of each column (`headerCells`).
2. The content script sends the snapshots to the service worker, which
   returns a `PageJudgment`.
3. For a table judged by rows, `transposeExtracted` turns the cell grid the
   same way `transposeSnapshot` turns the text.
4. `paintTable` shades each encoded column and attaches a card to each
   shaded header. `unpaint` removes all of it.

## Design decisions

- **A span-aware grid.** `buildGrid` expands `rowspan` and `colspan` so a
  column index names one column on every row. Spans are capped at
  `MAX_SPAN` (64).
  `modalWidth` sets the table's width from the most common row width, and
  rows that do not fill that width are skipped, so one malformed row does
  not misalign the rest.
- **Cell text is what the user sees.** `cellText` reads `innerText`, which
  leaves out hidden sort keys. It skips buttons, form controls, and
  footnote superscripts by walking the nodes, not by string replacement.
- **Some tables are skipped.** Tables with `role="presentation"`, tables that
  contain tables, and tables in an editable region (`isContentEditable`) are
  not extracted. An editor would save painted styles with the document.
- **Colors come from the real background.** `effectiveBackground` walks up
  from the cell's row to the first background that is more than half
  opaque. `resolveColor` draws the computed color to a one-pixel canvas, so
  `oklch()` and `color-mix()` resolve. That background sets `isDark`, which
  picks the light or dark ramp, and it is the base that `cellFill` blends
  over.
- **Painting writes only inline styles and `data-pd-*` attributes.**
  `setStyle` sets each property with `!important` and records its original
  inline value and priority in `originals`. `restoreStyles` puts back only
  those properties, so changes the page made after painting survive. When
  nothing else changed, it restores the original `style` attribute exactly.
  The painter adds no elements to the table. The header mark is extra
  background layers on the header cell, so column widths do not change.
- **Overlays are isolated.** The hover card and the controls bar are in
  shadow roots. Their host `<span>` elements are appended to `<html>`, not
  `<body>`, and carry an important inline `all: initial`, so page rules that
  match them cannot give them a box. Page text reaches them only through
  `textContent` and d3's `.text()`, never `innerHTML`.
- **Reads before writes.** `paintColumn` computes every fill before it sets
  any style. A computed-style read after a write forces a style
  recalculation, so interleaving them makes painting quadratic in the row
  count. A 10,000-row table with five shaded columns paints in about 0.2 s.

## Invariants

- `paintTable` followed by `unpaint` leaves the table's markup as it was,
  apart from changes the page made in between. The e2e run checks this on
  every fixture page.
- `cells[r][c]` is the element for `snapshot.rows[r][c]`. A spanned cell
  appears in each slot it covers, and `paintColumn` paints it once.
- Snapshot ids are `t<index>` among all tables in document order, whichever
  tables `include` accepts.
- The content script's `MutationObserver` watches child lists and text, not
  attributes, so painting does not trigger another run.
- A change to what `extractTable` returns changes request bodies. Regenerate
  `fixtures/snapshots/` with `npm run snapshot` and check
  `npm run eval -- --offline --strict` for missing recordings.

## Test

```sh
npm run build                 # also writes dist-probe/probe.js
npm run e2e -- --offline      # the built extension in Chromium, with replayed answers
npm run snapshot              # what the extractor sees on each fixture page
```

`scripts/e2e.ts` checks painting, contrast, header widths, unpaint, the
controls, page CSS against the shadow hosts, and the extractor on malformed
and editable tables. Its output lists one line per page and per scenario.
