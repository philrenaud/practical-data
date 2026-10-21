# The free endpoint

`api.practicaldata.dev` lets the extension work without the user's own
TypeSafe key. It is a Cloudflare Worker that accepts the System One requests
the extension sends and forwards them to TypeSafe with the operator's key.
The configuration is in `api/wrangler.jsonc`.

| File              | Contents                                                                    |
| ----------------- | --------------------------------------------------------------------------- |
| `worker.ts`       | Routes, origin and install checks, the shared cache, and the upstream call. |
| `allow.ts`        | The allowlist (`checkRequest`), `readBody`, and `readJudgeBody`.            |
| `quota.ts`        | The `Quota` Durable Object, which holds one UTC day's counts.               |
| `cloudflare.d.ts` | The Workers runtime types that this directory uses.                         |

## Routes

| Route                | Body                                            | Response                                      |
| -------------------- | ----------------------------------------------- | --------------------------------------------- |
| `POST /v1/systemone` | `{ state, questions }`                          | A System One response.                        |
| `POST /v1/judge`     | `{ title, table: { title, headers, rows } }`    | `{ table: TableJudgment \| null, usage }`     |
| `GET /v1/health`     | None                                            | `{ ok: true }`                                |
| `GET /v1/stats`      | None. Send `Authorization: Bearer STATS_TOKEN`. | Today's installs, requests, and input tokens. |

The Worker sets the model from `MODEL`. It ignores a `model` field in the
body.

`/v1/judge` serves the Google Sheets add-on, which cannot run the judge in
Apps Script. The add-on is not in this repository. The Worker builds the
questions from the table with `judgePage` and sends them through the same
`ask` function as `/v1/systemone`. Each upstream request that the route
makes counts against the caller's allowance.

Every refusal is JSON of the form `{ error, message }`. The `error` field is
one of `origin`, `install`, `rate_limited`, `body`, `questions`, `table`,
`install_limit`, `budget_spent`, `upstream`, `auth`, or `not_found`.

## Request flow

Both POST routes run these steps in order. The first step that fails sends
the refusal.

1. **Origin.** `originAllowed` refuses any Origin that is not
   `chrome-extension://`. A request with no Origin passes, because Apps Script
   sends none. When `ALLOWED_ORIGINS` is set, an extension origin must be in
   the list. The response has no CORS headers, so a web page cannot read it
   either way.
2. **Install id.** The `X-Practical-Data-Install` header must be a UUID in
   lowercase hex. The extension makes one on first use (`getInstallId` in
   `src/ext/settings.ts`).
3. **Rate limits.** The `RL_INSTALL` and `RL_IP` bindings limit requests per
   minute by install id and by `CF-Connecting-IP`. A refusal is a 429 with
   `Retry-After: 10`.
4. **Body.** `readBody` stops reading past 256 KiB and parses the body as
   JSON.
5. **Allowlist.** For `/v1/systemone`, `checkRequest` must accept the body.
   Every question must match one that the extension asks. The state and the
   table-data fields (`row`, `first_column`, and `columns`) must have the
   shapes that the builders produce, within the size limits below. For
   `/v1/judge`, `readJudgeBody` checks the table's size and shape.
6. **Shared cache.** `ask` hashes `{ model, state, questions }` with SHA-256
   and looks up the hash in `caches.default`. A hit returns at once, with
   `X-Cache: hit`, and spends no allowance.
7. **Daily quota.** `Quota.reserve` counts one request for the install. A
   refusal is a 429 with `X-Practical-Data-Quota` set to `install_limit` or
   `budget_spent`, and `Retry-After` set to the seconds until midnight UTC.
8. **Forward.** The Worker posts the request to `UPSTREAM_URL` with
   `TYPESAFE_API_KEY`. `validateAnswers` checks the answers against the
   questions. After the response, `ctx.waitUntil` caches the answers for 30
   days and adds the input tokens to the day's total with `Quota.charge`.

Every response that spent from the allowance carries
`X-Practical-Data-Remaining` and `X-Practical-Data-Limit`. Cache hits carry
neither. `src/ext/allowance.ts` turns these headers into the popup's
messages.

## Design decisions

- **An allowlist instead of user accounts.** The extension has no sign-in,
  and an embedded key would be public. The allowlist limits the endpoint to
  the extension's own questions, so a leaked endpoint is not a free
  general-purpose model.
- **References built from the question builders.** `allow.ts` calls the
  builders in `src/decide/questions.ts` with placeholder values. A wording
  change in `questions.ts` therefore changes the allowlist in the same commit.
  `test/allow.test.ts` replays every recorded request from the eval pages
  through `checkRequest`, so a mismatch fails `npm test`.
- **A cache key that is a hash of the request.** The same table produces the
  same request for every user, so one answer serves them all. The key holds
  only the hash, and the cached value holds only the answers. Neither holds
  the table text.
- **One Durable Object per UTC day.** Each day starts with empty counts, and
  no job resets them. An alarm deletes each day's storage two days after its
  first reservation.
- **Install ids are not proof of identity.** A client can make up a new id
  for each request. `INSTALL_DAILY_REQUESTS` limits ordinary heavy use.
  `DAILY_TOKEN_BUDGET` is the limit that holds against made-up ids.
- **Provider errors stay on the server.** The client gets the upstream status
  and `Retry-After`, never the provider's error body.

## What the Worker stores

- The Cloudflare cache holds answers under the SHA-256 hash of the request,
  for 30 days. The cache is per data centre.
- The `Quota` object for each day holds a request count per install id and
  the day's input-token total. The alarm deletes it two days later.
- The rate-limit bindings hold counters by install id and by IP for one
  minute.

The Worker writes no logs. `observability` is off in `api/wrangler.jsonc`, and
the code calls no `console` method.

## Limits

| Limit                              | Value                                         | Set by                                         |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Requests per install per minute    | 60                                            | `RL_INSTALL` in `api/wrangler.jsonc`           |
| Requests per IP per minute         | 120                                           | `RL_IP` in `api/wrangler.jsonc`                |
| Model requests per install per day | 400                                           | `INSTALL_DAILY_REQUESTS`                       |
| Input tokens per day, all installs | 5,000,000                                     | `DAILY_TOKEN_BUDGET`                           |
| Body size                          | 256 KiB                                       | `LIMITS.bodyBytes` in `allow.ts`               |
| Questions per request              | 200                                           | `LIMITS.questions`                             |
| State                              | 32 KiB of JSON                                | `LIMITS.stateBytes`                            |
| Each table-data field              | 16 KiB of JSON                                | `LIMITS.fieldBytes`                            |
| State and table data together      | 64 KiB of JSON                                | `LIMITS.dataBytes`                             |
| Each string in state or table data | 2,000 characters                              | `LIMITS.text`                                  |
| Each list or row in state or data  | 200 items                                     | `LIMITS.items`                                 |
| Each header or label in a question | 300 characters                                | `LIMITS.hole`                                  |
| Table sent to `/v1/judge`          | 60 columns, 2,000 rows, 300 characters a cell | `LIMITS.columns`, `LIMITS.rows`, `LIMITS.cell` |
| Upstream timeout                   | 20 seconds                                    | `UPSTREAM_TIMEOUT_MS` in `worker.ts`           |
| Cache lifetime                     | 30 days                                       | `CACHE_TTL_S` in `worker.ts`                   |

`Quota.charge` adds tokens after each response arrives. Requests in flight
can therefore take the day's total past `DAILY_TOKEN_BUDGET`.

At Jev's $0.042 per million input tokens, the default budget is about $0.21
a day. `GET /v1/stats` reports the day's usage.

## Run and test locally

`npm test` runs `test/allow.test.ts`, which covers the allowlist, `readBody`,
and `readJudgeBody`.

`npm run api:smoke` runs the Worker end to end without calling TypeSafe. It
starts `wrangler dev` on port 8799 with a stand-in for TypeSafe that replays
`fixtures/recordings/`. It checks the cache, the refusals, and the quota
error, and then loads a fresh build of the extension against the local
Worker. It keeps local state in `artifacts/api-dev/` and rebuilds `dist/` for
production when it finishes.

To run the Worker by hand, start it with `npm run api:dev`. Then build the
extension against it:

```sh
PD_API_ORIGIN=http://127.0.0.1:8787 npm run build
```

The build adds that origin to the manifest's host permissions.

## Deploy

The Worker does not deploy with the site. Deploy it by hand:

```sh
npx wrangler@4.147.0 secret put TYPESAFE_API_KEY -c api/wrangler.jsonc
npx wrangler@4.147.0 secret put STATS_TOKEN -c api/wrangler.jsonc
npm run api:deploy
curl https://api.practicaldata.dev/v1/health
```

To accept only the store build, set `ALLOWED_ORIGINS` to
`chrome-extension://<store id>`, and add the unpacked id while you test. To
turn the free endpoint off, set `DAILY_TOKEN_BUDGET` to `0`. Every request
then gets the `budget_spent` refusal, and the extension points users to
their own key.
