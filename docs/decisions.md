# Design decisions

Why Practical Data asks its questions the way it does, why Jev is the default
model, and how the colors are chosen. For the steps from a page snapshot to a
judgment, the questions per column kind, and the thresholds, see
[src/decide/README.md](../src/decide/README.md).

## Code computes, the model judges

Jev's documented weak spots are arithmetic, counting, numeric
representations, and large state with distracting detail. So code owns every
number, and the model only ever reads words:

- `parseNumber` reads currency, percentages, multipliers, K, M, and B
  suffixes, accounting negatives, footnote markers, fractions (`7 ⁄ 8`, `2½`),
  heights (`6' 6"`), and bounds such as `≤ 272K`. Clock durations parse as
  base-60 numbers, so `3:00` is one more than `2:59` and a season-long
  `1544:10` still reads; `7:05` next to dates stays a point in time. A range
  (`20–25`) parses to its midpoint and keeps its ends; a magnitude written
  once distributes to both ends, so `$50–60K` means $50,000 to $60,000,
  while `500–1K` keeps its bare low end because distributing would invert
  the range.
- The page's `lang` picks the number convention. On a comma-decimal page
  (German, Italian, Turkish, and most of Europe), `65.890` is 65,890 and
  `891,12` is 891.12; a dot counts as a thousands separator only when every
  group has three digits, so `1.5` stays text instead of misreading. A bare
  `es` keeps the dot-decimal reading, because Spain writes `1.234,56` while
  Mexico writes `1,234.56`. Currency symbols also read after the number
  (`1.299,00 €`), the usual order in most of Europe.
- A cell with more than one number parses only when the leftover text says
  what the rest means, and each form has its own rule: a value with its
  change (`740 (-16)`), a value with a condition (`$0.20 / MU for requests up
  to 128K`), a measurement with its conversion (`317.7 km/h (197 mph)`), a
  count with its share of the whole (`22 (13.1%)`). Anything ambiguous stays
  text and never enters a scale; the parser would rather leave a column
  plain than shade a guess.
- `profileTable` decides whether a column is numeric, a short set of labels,
  or text, and computes the extents, the spread, and hints such as
  `isSequence`, `looksLikeYears`, and `boundShare`. Two column shapes are
  rewritten before profiling: streaks (`W3` is 3, `L2` is -2, only when the
  whole column has the form) and values carrying their own rank
  (`47% (9)`, only when the ranks run 1..n and never contradict the values).
- The model gets those facts as words. It reads "values span about 2 orders
  of magnitude", not `max/min = 100`.

The model answers only questions of meaning: is this an amount, which
direction is better, do ratios matter, and what order do these labels
follow.

## What the probes showed

The scripts in `scripts/probes/` compare question wordings on real columns.
These results set the current design:

- A relation Choice works better than an "is it ordinal?" Noul. The Noul
  gave Category (Lightweight, Versatile, Powerful) 0.45 and Status (Open,
  Resolved) 0.72. The Choice names the alternatives, such as statuses and
  options. With it, true ordinals moved to between 0.6 and 1.0.
- Pairwise questions work better than "what position is X?" for columns
  with more than three levels.
- The direction must be anchored. With the wording "which comes earlier",
  GPU tiers and card rarities came out reversed, because catalogs list the
  flagship first. With "which is the lower grade: smaller, weaker, cheaper,
  less severe, more common" in the criteria, every case came out in the
  correct order.
- Each pair is asked in both orders, and the answers are averaged. The
  average cancels a mild preference for slot `a`.
- A categorical column gets its own request. With the full table in the
  state, pairwise orders got worse, such as C < M < U < R.
- Sibling headers help the ordinal call. With the table's other headers in
  the state, Lightweight, Versatile, Powerful went from 0.67 to 0.85. True
  non-ordinals, such as Status, Region, and Team, stayed at 0.00.
- Strong pairwise agreement counts. A column is ordinal at P(ordered
  levels) ≥ 0.7. It is also ordinal at ≥ 0.4 when the pairwise answers agree
  at ≥ 0.85. The cutoff was 0.5 until P(ordered levels) for Lightweight,
  Versatile, Powerful fell to 0.41 to 0.53 on a table that listed them in the
  order Powerful, Lightweight, Versatile. The first answer depends on the
  order in which the labels appear; the pairwise answers barely do (0.98).
  At 0.4, the eval corpus sent one more pairwise request and no other result
  changed. At 0.35, a column of plan names got an order and was shaded.
- Two-level ordinals are dropped after cross-table sharing. Every unstable
  ordinal call in the corpus had two levels, such as GA and Preview, or
  Default and Long context. Jev's answer on them moved between 0.55 and 0.61
  across runs. Two levels carry one bit that the text already shows.
- The orientation criteria are structural. They compare what the headers
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

The corpus now has 54 pages. `npm run eval -- --offline --strict` reports 446
requests and 1,007,863 input tokens. Those are the recorded token counts, so a
cold run costs the same. At $0.042 per million input tokens, a full cold run
with Jev costs about $0.04.

## Color

- Diverging scales use RdYlGn, or RdYlBu in the color-blind palette. They
  are oriented so that 1 always means better.
- Neutral amounts use YlGnBu. Ordinals use Purples. On dark pages,
  single-hue scales ramp from the page background toward the hue. Otherwise
  the scheme's near-white low end would be the brightest cell.
- Tints blend over the row's background, not the cell's. The tint replaces
  the cell's own color, such as Wikipedia's hurricane-category colors.
- Contrast is checked per cell in `src/core/tint.ts`. The code tries the
  page's text color, then near-black or white. If neither reaches 4.5:1, it
  pulls the tint back until the text does.

## Known limits

- Single-letter category codes need domain knowledge that the model lacks.
  Jev ranks `M` below `U` and `R` in Scryfall's C, U, R, M rarities.
- Heights written `6-1` read as ordered grades, not feet and inches. The
  eval carries that miss on a roster page; `6' 1"` parses fine.
- The extension judges tables that a site renders after a user action when
  they appear, through a MutationObserver. It does not read canvas or
  virtualized grids.
- Live MTGGoldfish rendered no price tables in headless Chromium. The saved
  copy of the page is still covered by the fixture runs.
