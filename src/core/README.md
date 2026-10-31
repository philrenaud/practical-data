# src/core

Plain functions and types that turn table text into scales and colors. The
code here has no DOM, `chrome.*`, network, or Effect dependencies. Its only
packages are d3-color, d3-interpolate, d3-scale, and d3-scale-chromatic. The
service worker, the content script (through `src/dom`), the free endpoint
(`src/api`), the eval and fixture scripts, the demo site, and the unit tests
all import it.

## Files

| File | What it has |
| --- | --- |
| `types.ts` | The JSON shapes that cross module boundaries: `TableSnapshot`, `PageSnapshot`, `ColumnEncoding`, `TableJudgment`, `PageJudgment` |
| `parse.ts` | `parseNumber`, `isMissing`, `isDateLike`, `stripNoise`, `normalizeLabel` |
| `dates.ts` | `parseDate` for one cell, `parseDateColumn` for a column, `formatDate` for legends |
| `profile.ts` | `profileTable`: each column as a `NumericProfile`, `CategoricalProfile`, or `TextProfile`. `describeSpread` |
| `order.ts` | `orderFromPairs`: label order from pairwise probabilities |
| `orient.ts` | `transposeSnapshot`, for tables whose rows are the measures |
| `palettes.ts` | `PALETTES`, `divergingColor`, `divergingStops` |
| `scale.ts` | `positions` (value to 0–1), `schemeColor` (position to color), `legendStops` |
| `tint.ts` | `cellFill`, `luminance`, `contrast`, `isDark` |
| `legend.ts` | `describeColumn`: the text of a header's hover card |

## Data flow

1. `src/dom/extract.ts` reads the page into a `PageSnapshot` of text.
2. `profileTable` decides what each column can be and computes its
   statistics.
3. `src/decide/judge.ts` asks the model about the numeric and categorical
   profiles, and orders categories with `orderFromPairs`. It shades date
   columns with `parseDateColumn` and does not ask the model about them. The
   result is a `TableJudgment` with one `ColumnEncoding` per shaded column.
4. `src/dom/paint.ts` calls `positions`, `schemeColor`, and `cellFill` for
   each cell, and `describeColumn` for each shaded header.

## Design decisions

- **No DOM or extension APIs.** The same code runs in the page, the service
  worker, Node, and the Cloudflare Worker. The free endpoint checks each
  request against questions made by the extension's own builders from these
  profile types, so the endpoint and the extension use one definition.
- **Code decides what is possible. The model judges meaning.** Profiles hold
  every statistic. The model answers only questions such as "is lower
  better?". `docs/decisions.md` explains the split.
- **Parsers return null on doubt.** `parseNumber` rejects dates, clock times,
  ordinals, and high-first scores ("35-10"). A wrong number in a scale is
  worse than an unshaded cell. Ranges parse to their midpoint, and clock
  durations ("2:59") parse as base-60 numbers. An estimate followed by its confidence
  interval ("73.7 95% CI 72.4–74.5") parses as the estimate.
- **Dates never reach the model.** `profileTable` marks a column where 80% of
  filled cells look like dates as text, and judge.ts shades it from earliest
  to latest. Numeric dates with an ambiguous day order ("3/4/2026") parse
  only when another cell in the column settles the order (a part over 12),
  or when the dates use dots, which are day first by convention.
- **Light and dark palettes, chosen per cell.** `divergingColor`,
  `schemeColor`, and `legendStops` take a `dark` flag. The painter sets it
  from the background behind each cell with `isDark`. Dark ramps fade to the
  background in the middle instead of passing through a light color.
- **Text contrast is a floor, not a goal.** `cellFill` blends the scheme
  color over the page background, then weakens the tint until the page's
  text color, or near-black or white, has a contrast of at least 5:1
  (`MIN_CONTRAST`). If no tint passes, the cell keeps the page background.

## Invariants

- Every row of a `TableSnapshot` has exactly `headers.length` strings.
- `positions` applies polarity, so 1 is always the better end, or the higher
  end when there is no better end. `schemeColor` takes that position as is.
- `profile.ts` output is part of every model request. Its samples, headers,
  levels, and statistics change the request bodies, so a change breaks the
  recordings in `fixtures/recordings/` (keyed by the SHA-256 of each body)
  and the deployed endpoint's allowlist. A change to profiles needs new
  recordings and an endpoint deploy.
- Lookups by cell text use own keys only (`Object.hasOwn`, `Map`), so text
  such as "constructor" is not read from `Object.prototype`.

## Test

```sh
npm test                               # test/*.test.ts, no network
npm run eval -- --offline --strict     # replays recorded answers; fails on a missing recording
```

Most files have a test file of the same name in `test/` (`parse.test.ts`,
`dates.test.ts`, `profile.test.ts`, and so on). `tint.test.ts` checks the
contrast floor for every palette, step, and page background. If the offline
eval reports missing recordings after a change here, the change altered a
request body.
