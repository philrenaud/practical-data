# Unit tests

`npm test` runs every `test/*.test.ts` file with the Node test runner. The
tests run offline and need no key.

Most tests call one module in `src/` with literal inputs and compare the
result with a literal expected value. `judge.test.ts` replaces the decision
model with a scripted one that answers by question id. Those tests check how
the judge combines answers, not what the model answers. The eval in
`scripts/eval.ts` tests the model's answers. See `scripts/README.md`.

| File | Module under test | What it covers |
| --- | --- | --- |
| `allow.test.ts` | `src/api/allow.ts` | The free endpoint's question allowlist and body reader. One test replays every recorded request for the fixture snapshots and checks that the allowlist accepts each one, so a changed question fails here before it fails in production. |
| `allowance.test.ts` | `src/ext/allowance.ts` | The free allowance shown in the popup: merging reported counts, the reset time, and the messages. |
| `concurrency.test.ts` | `src/decide/concurrency.ts` | Result order, the concurrency limit, and the abort on the first failure. |
| `dates.test.ts` | `src/core/dates.ts` | Parsing of dates, months, times, relative times, and ranges of days, and the legend's date text. |
| `judge.test.ts` | `src/decide/judge.ts` | Shared scales, declined columns, failed requests, ranks, brackets, and date columns, with a scripted model. |
| `legend.test.ts` | `src/core/legend.ts` | The legend's status line, extents, and facts. |
| `model.test.ts` | `src/decide/model.ts` | Answer validation, and the quota errors and allowance headers of the hosted transport. |
| `order.test.ts` | `src/core/order.ts` | Building an order from pairwise answers. |
| `orient.test.ts` | `src/core/orient.ts` | Transposing a table that is compared across rows. |
| `parse.test.ts` | `src/core/parse.ts` | Number parsing, missing-value placeholders, and durations. |
| `profile.test.ts` | `src/core/profile.ts` | Column profiling by kind. |
| `scale.test.ts` | `src/core/scale.ts`, `src/core/palettes.ts` | Scale positions and palette ends. |
| `tint.test.ts` | `src/core/tint.ts` | Text contrast on every palette step against several page colors. |

## Conventions

- Name each test with a sentence that states the behavior. The `/tests` page
  on the site lists the names, through `scripts/tests-data.ts`.
- Keep tests at the top level. `tests-data.ts` reads the TAP output and
  expects no `describe` blocks.
- Restore `globalThis.fetch` in a `finally` block if a test replaces it.
- Run one file with `node --test test/dates.test.ts`.
