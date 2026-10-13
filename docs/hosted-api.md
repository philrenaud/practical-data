# The free endpoint

`api.practicaldata.dev` lets the extension work without a key of the reader's
own. It is a Cloudflare Worker (`src/api/worker.ts`, configured in
`api/wrangler.jsonc`) that takes the same System One request the extension
would send to Jev and forwards it to TypeSafe with the operator's key.

A second route, `POST /v1/judge`, takes a whole table
(`{ title, table: { title, headers, rows } }`) and returns its judgment. It
serves the Sheets add-on (docs/sheets-addon.md), which can't run the judge in
Apps Script. The questions are built on the server from the table, so this
route needs no allowlist; it shares every other step below, and each model
request it makes counts against the same allowance. Tables are capped at 60
columns, 2,000 rows and 300 characters a cell (`readJudgeBody` in
`src/api/allow.ts`).

## What it does with a request

1. **Origin.** Requests from web pages (an `http(s)://` Origin) are refused.
   With `ALLOWED_ORIGINS` set, only those `chrome-extension://` origins pass,
   plus requests with no Origin at all, which is how Apps Script calls.
   Non-browser clients can send any Origin, so this stops casual misuse from
   web pages, not a determined caller; the steps below bound the rest.
2. **Install id.** Every request carries `X-Practical-Data-Install`, a random
   UUID the extension makes on first use (`getInstallId` in
   `src/ext/settings.ts`).
3. **Rate limits.** 60 requests a minute per install and 120 per IP, by
   Cloudflare's rate-limiting binding. A busy page sends 20–30 requests at
   once, mostly answered from the cache on repeat visits.
4. **Allowlist.** Each question must match one the extension asks
   (`src/api/allow.ts`): reference questions are built by the extension's own
   question builders, with headers, labels and sample data as the only free
   parts, at most 300 characters each. The endpoint therefore can't be used as
   a general-purpose model. `test/allow.test.ts` replays every request from the
   eval pages through the allowlist, so a wording change in
   `src/decide/questions.ts` that the allowlist doesn't accept fails `npm test`.
5. **Shared cache.** Answers are cached for 30 days by a hash of the request,
   so the same table asked by any reader is answered without calling TypeSafe.
   Cache hits don't count against the daily allowance. Cloudflare's cache is
   per data centre, so readers in different regions fill it separately.
6. **Daily allowance.** A Durable Object per UTC day (`src/api/quota.ts`)
   counts model requests per install and input tokens in total. Past
   `INSTALL_DAILY_REQUESTS` for an install, or `DAILY_TOKEN_BUDGET` overall,
   the endpoint answers 429 with `X-Practical-Data-Quota`. The extension shows
   "Today's free allowance is used up. Add your own key in Options", and stops
   asking for 15 minutes. Each day's object deletes itself two days later.
7. **Forward.** To `UPSTREAM_URL` with `TYPESAFE_API_KEY`, model `MODEL`.
   Answers are checked against the questions before they are cached or
   returned. Provider errors reach the client only as a status, never the
   provider's message.

Nothing is logged (`observability` is off, and the code doesn't log).

## Cost

The worst case is set by `DAILY_TOKEN_BUDGET`: at Jev's $0.042 per million
input tokens, the default 5M tokens is about $0.21 a day, roughly 150–300
uncached page views. The per-install cap of 400 requests is about 15–40
pages a day for one reader. Raise the budget as the cache hit rate shows what
real traffic costs (`GET /v1/stats` with `Authorization: Bearer STATS_TOKEN`
reports today's installs, requests and tokens).

Cloudflare's side is small next to that: each uncached page view is a few
Worker requests and Durable Object calls, well inside Workers' free daily
allowance until the extension has thousands of daily readers.

## Operating it

```sh
npm run api:smoke                                   # local end-to-end check, no network
npx wrangler@4.147.0 secret put TYPESAFE_API_KEY -c api/wrangler.jsonc
npx wrangler@4.147.0 secret put STATS_TOKEN -c api/wrangler.jsonc
npm run api:deploy
curl https://api.practicaldata.dev/v1/health
```

After the Web Store listing is live, set `ALLOWED_ORIGINS` to
`chrome-extension://<store id>` (plus the unpacked id while testing) and
redeploy. To point a local build at `npm run api:dev`, build with
`PD_API_ORIGIN=http://127.0.0.1:8787 npm run build`; the build adds that
origin to the manifest's host permissions.

To turn the free tier off, set `DAILY_TOKEN_BUDGET` to `0`: every request
gets the quota answer, and readers are pointed to their own key.
