# src/decide

This directory turns a `PageSnapshot` into a `PageJudgment`. The judgment
lists, for each table, the columns worth shading and how to shade them. Code
measures the columns. A decision model answers fixed questions about what the
columns mean, and code applies thresholds to the answers.

The entry point is `judgePage(model, page, policy, orientations, now)` in
`judge.ts`. It takes a `DecisionModel` from `model.ts` and returns a promise.

## Files

| File | Contents |
| --- | --- |
| `questions.ts` | Builds the request state and the questions, and reads the answers into `NumericReading` and `CategoricalReading`. |
| `judge.ts` | `judgePage`, `Policy`, and `DEFAULT_POLICY`. Sends the requests and applies the thresholds. Handles orientation, summary rows, date columns, and shared scales. |
| `model.ts` | The `DecisionModel` interface, the providers (`hosted`, `jev`, `clef`), retries, rate limiting, `decodeDecisionResponse`, `validateAnswers`, and the `AnswerCache` interface. |
| `concurrency.ts` | `mapConcurrent`, a bounded map that stops at the first failure, and an abortable `sleep`. |

Code in `src/core` does the parts that need no model: `profile.ts`,
`parse.ts`, `dates.ts`, `order.ts`, and `orient.ts`.

## From snapshot to judgment

1. `judgePage` keeps the tables with at least 3 rows and 2 headers. It judges
   up to 6 tables at once.
2. `profileTable` (`src/core/profile.ts`) puts each column in one of three
   kinds. A numeric column has parsed values, a unit, extents, and hints such
   as `isSequence` and `looksLikeYears`. A categorical column has 2 to 12
   distinct short labels. Every other column is text, with a reason such as
   "every value is unique" or "dates or times".
3. `judgeColumns` sends one request for the table. Its state comes from
   `tableState`: the page and table titles, the row-label column, and one
   description per numeric column. `describeSpread` gives the spread in
   words, such as "values span about 2 orders of magnitude", not as a ratio.
4. Each categorical column gets its own request, with `categoricalState` as
   the state. A second request asks the pairwise order questions, but only
   when the labels might be ordered. Finishing places (3rd, 14th, 7th (tie))
   get no pairwise questions: `placeOrder` orders them by their numbers, and
   places that count the rows are skipped, like ranks.
5. The `read` functions return probabilities, and the `Policy` thresholds
   turn them into a `ColumnEncoding` or a `SkippedColumn` with a reason.
6. `dateEncodings` encodes the date columns without the model.
7. `shareAcrossTables` sends one page request about columns that may share a
   scale across tables.
8. `dropBinaryOrdinals` moves ordinal columns with two levels to `skipped`.

## Questions per column kind

All question ids carry the column index, so one request can hold many
columns. The table request holds these:

| Id | Type | Asked when | Used for |
| --- | --- | --- | --- |
| `n{col}.role` | Choice: measure, identifier, time, rank, bins, record, threshold | Every numeric column | Shade when P(measure) + P(bins) + P(rank) ≥ `measure`. Bins do not count when `namesRows` is true. Ranks do not count when `followsRows` is true. |
| `n{col}.polarity` | Choice: higher is better, lower is better, neutral | Every numeric column | The scale direction. Neutral when neither direction reaches `polarity`. |
| `n{col}.log` | Noul | `logEligible`: the values span at least 10x | Log scale at ≥ `log`, when the domain is positive and the role is not rank. |
| `row{r}.aggregate` | Noul | The first two and last two rows of a table with 5 or more rows | A row at ≥ `aggregate` is left out of every domain. |
| `table.orientation` | Choice: columns, rows | Two or more numeric columns, and no orientation chosen by the user | Judge the table transposed at P(rows) ≥ `rows`. |

Each categorical column request holds these:

| Id | Type | Asked when | Used for |
| --- | --- | --- | --- |
| `c{col}.relation` | Choice: ordered levels, unordered kinds, workflow states, options, scores or records, names or versions | Every categorical column | P(ordered levels) decides whether the column is ordinal. |
| `c{col}.polarity` | Choice, as for numeric columns | Every categorical column | The scale direction. |
| `c{col}.lt{i}_{j}` | Choice: `a` or `b` is the lower grade | P(ordered levels) ≥ `ordinalWithStrongOrder`, in a second request | `orderFromPairs` (`src/core/order.ts`) sorts the labels by their summed win probability. |

Each pair of labels is asked in both orders, and the two answers are
averaged. The page request holds one `g{n}.share` Noul per group, and
`g{n}.lt{i}_{j}` pairs for ordinal groups whose tables have different labels.

## Thresholds

`DEFAULT_POLICY` holds the thresholds:

| Field | Value | Meaning |
| --- | --- | --- |
| `measure` | 0.7 | Shade a numeric column. |
| `ordinal`, `orderConfidence` | 0.7, 0.7 | Shade a categorical column. Both must hold. |
| `ordinalWithStrongOrder`, `strongOrder` | 0.5, 0.85 | The other way to shade a categorical column. Below 0.5, no pairwise questions are sent. |
| `polarity` | 0.55 | Use a direction. Otherwise the scale is neutral. |
| `log` | 0.5 | Use a log scale. |
| `aggregate` | 0.5 | Leave a row out of the domains. |
| `share` | 0.5 | Put a group of columns on one scale. |
| `rows` | 0.75 | Judge a table transposed. |

## Orientation

Some tables compare values across rows, such as benchmarks as rows and models
as columns. `orientationQuestion` goes in the first request, so the common
case costs no extra request. At P(rows) ≥ `rows`, `judgeTable` judges
`transposeSnapshot(table)` again and marks the judgment `orientation: "rows"`.
A user's choice in `orientations` skips the question. Tables with more than
`MAX_TRANSPOSE_ROWS` (40) rows are always judged by columns.

## Date columns

`profileTable` marks a column as "dates or times" when at least 80% of its
filled cells look like dates. These columns never go to the model. `dateEncodings` parses them with
`parseDateColumn` and encodes them as quantitative, neutral, and linear, from
earliest to latest. Relative dates such as "3 days ago" count back from
`now`. A weekday with a clock time and no date ("Sun 1:00 PM") is a time in
a week, and the column's week starts after its longest gap, so a Thursday to
Monday schedule reads in order. Date columns are never offered for shared scales.

## Shared scales

`findGroups` groups encoded columns from two or more tables by `groupKey`:
the kind, the normalized header, and the unit. `byMagnitude` splits a
quantitative group when magnitudes differ by more than `MAX_SHARE_RATIO`
(10x), so these columns are never offered to the model. One page request asks
a `shareQuestion` per group.

For a shared quantitative group, every member gets the union of the domains,
one transform, and one direction. The transform is log when at least half of
the members use log. For a shared ordinal group, every member gets one order.
If the tables have different labels, the order comes from the `g{n}.lt`
answers for the union of the labels. A group whose union has more than
`MAX_UNION_LEVELS` (12) labels is not shared. `sharedPolarity` averages the
members' polarity probabilities.

If the share request fails, each table keeps its own scales.

## Provider layer

`model.ts` defines `DecisionModel`, an interface with `name` and
`evaluate(request, signal)`. `makeModel` builds it from a `Transport` and an
`AnswerCache`:

- `evaluate` splits the questions into chunks of `maxQuestions`: 200 for
  `jev` and `hosted`, and 64 for `clef`. Each chunk has the full state.
- Each chunk body is `{ model, state, questions }`. Its cache key is
  `hashJson(body)`, the SHA-256 of its JSON.
- On a cache hit, `validateAnswers` checks the stored response against the
  questions. A response that fails is fetched again.
- `sendOnce` allows 8 requests in flight per provider and sets a 20 s
  timeout. `send` retries `rate_limited`, `overloaded`, and `network` errors
  4 times. The waits start at 250 ms and double, with ±20% jitter. `hosted`
  retries an `overloaded` error once. A `Retry-After` header adds a wait of
  up to 30 s. A response with an `x-practical-data-quota` header is never
  retried.
- `decodeDecisionResponse` checks the shape of each response and keeps only
  the known fields.
- Chunks run 4 at a time. When one chunk fails, the others are aborted and
  `evaluate` rejects with that failure.
- Every fresh response must pass `validateAnswers` before it is cached.

The providers:

- `hosted` sends requests to `API_ORIGIN/v1/systemone`, the endpoint in
  `src/api`, with an install id header. Responses report the remaining
  allowance in headers, which `allowanceOf` reads.
- `jev` sends requests to TypeSafe with the user's API key.
- `clef` sends requests to Cloudflare Workers AI with the user's account id
  and token.

`modelFromConfig` picks one from a `ProviderConfig`. Each provider takes an
optional `AnswerCache`. Without one, it uses `noCache`. The extension passes
a cache backed by `chrome.storage.local`. The scripts pass a cache of files
in `fixtures/recordings` (`scripts/lib/cache.ts`).

`judgePage` judges each table on its own. A table whose requests fail goes in
`failed`, and the other tables keep their results. Only a `DecisionError` is
caught this way. Any other error rejects `judgePage`. Within one table, the
first failed request aborts the table's other requests. `usage.requests` counts
`evaluate` calls, including cache hits.

## Design decisions

- **A decision model that returns probabilities, not an LLM that writes
  text.** Each answer is a typed probability, so code applies a threshold
  and there is no text to parse.
- **Code computes every number.** Jev is weak at arithmetic and counting, so
  the model gets words such as "values are within a factor of 2 of each
  other".
- **The questions are fixed strings.** A request hash finds its recording,
  so the offline eval is deterministic. `src/api/allow.ts` builds its
  allowlist from the same builders, so the hosted endpoint answers only
  these questions.
- **Code encodes dates.** A date column is always comparable and has no
  better direction, so a question could only add cost and errors.
- **Code decides that ranks and brackets repeat the rows.** `followsRows` and
  `namesRows` are exact checks. The model sees only examples.
- **Each categorical column gets its own request.** With the full table in
  the state, pairwise orders got worse.
- **Pairs are asked in both orders.** The average cancels the model's
  preference for slot `a`.
- **Two-level ordinals are dropped.** They carry one bit that the text
  already shows, and the model's answers on them were the least stable.
- **Ranks are always linear.** Ranks are evenly spaced positions.
- **Columns of different magnitude never share a scale.** The smaller
  column would show as one color.

[docs/decisions.md](../../docs/decisions.md) has the probe results behind
the question wording and a comparison of Jev and Clef.

## Evaluate a change

```sh
npm run eval -- --offline --strict
```

The eval judges each page in `fixtures/snapshots` and scores the result
against the hand labels in `fixtures/expectations.json`. With `--offline`,
every answer comes from `fixtures/recordings`. If a request has no
recording, the run fails and reports the count. With `--strict`, the run
also fails on any mismatch not listed under `$known` in
`fixtures/expectations.json`. Use `--only <slug> --verbose` to see one page.

Without `--offline`, the eval calls Jev with `TYPESAFE_API_KEY` and records
the new answers. To change a question's wording, do these steps:

1. Change the builder in `questions.ts`.
2. Run `npm run eval` with a key, and commit the new recordings.
3. Deploy the Worker with `npm run api:deploy`, so that `allow.ts` accepts
   the new wording.

`test/judge.test.ts` checks how `judgePage` combines answers, with a
scripted model that answers by question id. `test/model.test.ts` covers
`validateAnswers`. The scripts in `scripts/probes` compare question wordings
on real columns.
