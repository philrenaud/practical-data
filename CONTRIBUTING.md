# Contributing

## Report a table that is shaded wrong

Open a
[wrong shading issue](https://github.com/philrenaud/practical-data/issues/new?template=wrong-shading.yml)
with the page URL, the column, what the extension did, and what you
expected. Issues are public, so report only pages that anyone can open.

To see the decision and the reason for every column on a page, run
`node scripts/explain-url.ts <url>`. This calls the decision model, so it
needs `TYPESAFE_API_KEY`.

## Run the checks

```
npm ci
npx playwright install chromium
npm run check
```

`npm run check` runs the format check, the type check, the unit tests, the
build, the eval, and the e2e. It replays recorded model answers from
`fixtures/recordings/`, so it needs no key and no network. The
[README](README.md#development) lists each command.

## Send a change

- Open a pull request against `main`. The `site` check runs the same checks
  and must pass. Pull requests are squash merged.
- A parsing or detection fix needs a unit test in `test/` that fails without
  the fix.
- A change that asks the model a new question has no recorded answer, so
  the offline eval fails on it. Recording an answer needs a TypeSafe key. If
  you have none, say so in the pull request and I will record the answers.
- A change to a prompt, a question, or a threshold also changes the scores.
  Include the output of `npm run eval -- --offline --strict` in the pull
  request.

[docs/architecture.md](docs/architecture.md) describes how the code is laid
out. [docs/decisions.md](docs/decisions.md) records why the questions are
designed the way they are.
