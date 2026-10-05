# Design decisions

## Code computes, the model judges

Jev's documented weak spots are arithmetic, counting, numeric representations,
and large distracting state. So code owns every number:

- `parseNumber` handles currency, percent, multipliers, K/M/B suffixes,
  accounting negatives, footnotes, and comparator bounds such as `≤ 272K`.
- `profileTable` decides what is possible: numeric, a short set of labels, or
  text. It computes extents, spread, and hints (`isSequence`, `looksLikeYears`,
  `boundShare`).
- The model receives those facts as words. It reads "values span about 2
  orders of magnitude", not `max/min = 100`.

The model answers only questions of meaning.

## Questions

Per table, one request covers every numeric column plus the aggregate-row
candidates. Questions about one state go together, because Jev evaluates them
in parallel at no extra latency.

| Question | Type | Used for |
| --- | --- | --- |
| `n{col}.role`: measure / bins / identifier / time / rank / record / threshold | Choice | Shade the column only if `measure` + `bins` ≥ 0.7 |
| `n{col}.polarity`: higher better / lower better / neutral | Choice | Diverging scale direction; neutral below 0.55 |
| `n{col}.log`: do ratios matter more than differences? | Noul | Asked only when the spread is at least 10×; log at ≥ 0.5 |
| `row{r}.aggregate`: is this row a total or average? | Noul | First two and last two rows; excluded from the domain |

Each categorical column gets its own request, with only that column's values
and the sibling headers in state.
In the full-table state, pairwise orders degraded (C < M < U < R):

| Question | Type | Used for |
| --- | --- | --- |
| `c{col}.relation`: ordered levels / unordered kinds / workflow states / options / scores or records / names or versions | Choice | Ordinal at `ordered_levels` ≥ 0.7, or ≥ 0.5 with pairwise agreement ≥ 0.85 |
| `c{col}.lt{i}_{j}`: which of `a`, `b` is the lower grade? | Choice, asked in both orientations, in a second request only when `ordered_levels` ≥ 0.5 | Order by summed win probability (`src/core/order.ts`) |

The table request also carries one speculative Choice when a table has two or
more numeric columns: are values compared down columns or across rows? At
P(rows) ≥ 0.75 the table is judged again, transposed, and painted row by row.
The criteria are structural (what the headers name versus what the first
column names). An earlier wording used "models" as its example of column
items, and a pricing table whose *rows* were models scored 0.69 for rows. A reader's choice from the table controls skips the
question.

Per page, one more request asks whether columns with the same normalized
header and unit in different tables share a scale (one Noul per group).

## What the probes showed

The scripts in `scripts/probes/` compare question designs on real columns.
These findings set the design:

- **Relation Choice beat an "is it ordinal?" Noul.** The Noul gave Category
  (Lightweight/Versatile/Powerful) 0.45 and Status (Open/Resolved) 0.72. The
  Choice names the alternatives (statuses, options), and true ordinals moved to
  0.6–1.0.
- **Pairwise beat "what position is X?"** once a column has more than three
  levels.
- **Direction must be anchored.** With the wording "which comes earlier", GPU
  tiers and card rarities came out reversed, because catalogs list the flagship
  first. With "which is the lower grade: smaller, weaker, cheaper, less severe,
  more common" in the criteria, every case ordered correctly.
- **Both orientations, averaged.** This cancels a mild preference for slot
  `a`.
- **Sibling headers help the ordinal call.** Giving the label question the
  table's other headers lifted Lightweight/Versatile/Powerful from 0.67 to
  0.85 and left true non-ordinals (Status, Region, Team) at 0.00.
- **Strong pairwise agreement counts.** A column is ordinal at P(ordered
  levels) ≥ 0.7, or at ≥ 0.5 when the pairwise order agreement is ≥ 0.85.
- **Two-level ordinals are dropped** after cross-table sharing. Every unstable
  ordinal call in the corpus had two levels (GA/Preview, Default/Long context),
  where Jev's answer moved between 0.55 and 0.61 across runs. Two levels carry
  one bit that the text already shows.

## Jev or Clef

Both expose the same System One request and answer shape, so each is a
transport in `src/decide/model.ts`. On this corpus (October 2026):

| | Jev 1.13 | Clef |
| --- | --- | --- |
| Show/hide accuracy | 100% | 98% |
| Polarity | 100% | 88%: hedges to neutral on price, SO, GIDP |
| Corpus wall time, cold | ~3.6 s | ~40 s |
| Price per M input tokens | $0.042 | $0.24 |
| Questions per request | no documented cap | 64; requests are chunked |

Jev is the default. The full 13-page corpus costs about 580k input tokens,
roughly $0.02.

## Color

- **Diverging scales use RdYlGn**, or RdYlBu in the color-blind palette, and
  are oriented so that 1 always means better.
- **Neutral amounts use YlGnBu. Ordinals use Purples.** On dark pages,
  single-hue scales ramp from the page background toward the hue. Otherwise
  the scheme's near-white low end would be the brightest cell.
- **Tints blend over the row's background**, not the cell's. The cell's own
  color, such as Wikipedia's hurricane-category colors, is what gets replaced.
- **Contrast is enforced per cell** (`src/core/tint.ts`): try the page's text
  color, then near-black or white, then pull the tint back until text reaches
  4.5:1.

## Known limits

- Single-letter category codes need domain knowledge the model lacks: Jev
  ranks `M` below `U` and `R` in Scryfall's C/U/R/M rarities.
- Tables that a site renders only after a user action are judged when they
  appear, through the MutationObserver. The extension does not look into
  canvas or virtualized grids.
- Live MTGGoldfish rendered no price tables in headless Chromium. The saved
  copy of the page is still covered by the fixture runs.
