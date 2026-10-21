# Design decisions

This page explains why Practical Data asks its questions the way it does, why
Jev is the default model, and how the colors are chosen. For the steps from a
page snapshot to a judgment, the questions per column kind, and the
thresholds, see [src/decide/README.md](../src/decide/README.md).

## Code computes, the model judges

Jev's documented weak spots are arithmetic, counting, numeric
representations, and large state with distracting detail. So code owns every
number:

- `parseNumber` reads currency, percentages, multipliers, K, M, and B
  suffixes, accounting negatives, footnotes, and bounds such as `≤ 272K`.
- `profileTable` decides whether a column is numeric, a short set of labels,
  or text. It computes the extents, the spread, and hints such as
  `isSequence`, `looksLikeYears`, and `boundShare`.
- The model gets those facts as words. It reads "values span about 2 orders
  of magnitude", not `max/min = 100`.

The model answers only questions of meaning: is this an amount, which
direction is better, do ratios matter, and what order do these labels
follow.

## What the probes showed

The scripts in `scripts/probes/` compare question wordings on real columns.
These results set the current design:

- **A relation Choice works better than an "is it ordinal?" Noul.** The Noul
  gave Category (Lightweight, Versatile, Powerful) 0.45 and Status (Open,
  Resolved) 0.72. The Choice names the alternatives, such as statuses and
  options. With it, true ordinals moved to between 0.6 and 1.0.
- **Pairwise questions work better than "what position is X?"** for columns
  with more than three levels.
- **The direction must be anchored.** With the wording "which comes
  earlier", GPU tiers and card rarities came out reversed, because catalogs
  list the flagship first. With "which is the lower grade: smaller, weaker,
  cheaper, less severe, more common" in the criteria, every case came out in
  the correct order.
- **Each pair is asked in both orders, and the answers are averaged.** The
  average cancels a mild preference for slot `a`.
- **A categorical column gets its own request.** With the full table in the
  state, pairwise orders got worse, such as C < M < U < R.
- **Sibling headers help the ordinal call.** With the table's other headers
  in the state, Lightweight, Versatile, Powerful went from 0.67 to 0.85. True
  non-ordinals, such as Status, Region, and Team, stayed at 0.00.
- **Strong pairwise agreement counts.** A column is ordinal at P(ordered
  levels) ≥ 0.7. It is also ordinal at ≥ 0.5 when the pairwise answers agree
  at ≥ 0.85.
- **Two-level ordinals are dropped** after cross-table sharing. Every
  unstable ordinal call in the corpus had two levels, such as GA and Preview,
  or Default and Long context. Jev's answer on them moved between 0.55 and
  0.61 across runs. Two levels carry one bit that the text already shows.
- **The orientation criteria are structural.** They compare what the headers
  name with what the first column names. An earlier wording used "models" as
  its example of column items. A pricing table whose rows were models then
  scored 0.69 for rows.

## Jev or Clef

Jev and Clef take the same System One request and return the same answers,
so each one is a transport in `src/decide/model.ts`. This comparison was
measured in October 2026, on the 13 pages the corpus had then:

|                          | Jev 1.13          | Clef                                          |
| ------------------------ | ----------------- | --------------------------------------------- |
| Show or hide accuracy    | 100%              | 98%                                           |
| Polarity                 | 100%              | 88%. It falls back to neutral on price, SO, and GIDP. |
| Corpus wall time, cold   | about 3.6 s       | about 40 s                                    |
| Price per M input tokens | $0.042            | $0.24                                         |
| Questions per request    | no documented cap | 64, so requests are split                     |

Jev is the default. The prices are the ones this repository uses throughout,
including README.md and docs/hosted-api.md.

The corpus now has 27 pages. `npm run eval -- --offline --strict` reports 290
requests and 739,390 input tokens. Those are the recorded token counts, so a
cold run costs the same. At $0.042 per million input tokens, a full cold run
with Jev costs about $0.03.

## Color

- **Diverging scales use RdYlGn**, or RdYlBu in the color-blind palette. They
  are oriented so that 1 always means better.
- **Neutral amounts use YlGnBu. Ordinals use Purples.** On dark pages,
  single-hue scales ramp from the page background toward the hue. Otherwise
  the scheme's near-white low end would be the brightest cell.
- **Tints blend over the row's background**, not the cell's. The tint
  replaces the cell's own color, such as Wikipedia's hurricane-category
  colors.
- **Contrast is checked per cell** in `src/core/tint.ts`. The code tries the
  page's text color, then near-black or white. If neither reaches 4.5:1, it
  pulls the tint back until the text does.

## Known limits

- Single-letter category codes need domain knowledge that the model lacks.
  Jev ranks `M` below `U` and `R` in Scryfall's C, U, R, M rarities.
- The extension judges tables that a site renders after a user action when
  they appear, through a MutationObserver. It does not read canvas or
  virtualized grids.
- Live MTGGoldfish rendered no price tables in headless Chromium. The saved
  copy of the page is still covered by the fixture runs.
