# Privacy policy

_Practical Data, a Chrome extension. Last updated October 21, 2026._

Practical Data shades the comparable columns of tables on web pages. To decide
what each column means, it asks a decision model. From version 1.1.0, that goes
by default through the free endpoint at `api.practicaldata.dev`, run by the
extension's author; you can instead use your own key with a provider you pay
for directly. Version 1.0.0 has no free endpoint and always uses your own key.
This page says exactly what each involves.

## What leaves your browser

When a table comes within about a screen of the viewport on a site where the
extension is on, the extension sends this to the provider set in its options:

- The page title.
- The table's caption or nearest heading, and its column headers.
- A few sample values from each column, and the distinct labels in label
  columns (for example `Lightweight`, `Versatile`, `Powerful`).
- The first and last two rows, to check whether they are totals.

It does **not** send the page URL, cookies, form contents, text outside
tables, or anything from tables you never scroll near.

## Who receives it

Only the provider set in the extension's options:

- **Free** (the default from version 1.1.0), at `api.practicaldata.dev`: a Cloudflare Worker run
  by the extension's author. It forwards the table text to TypeSafe (below)
  with the author's key and returns the answers. It receives, along with the
  table text, a random id the extension makes when installed (not derived from
  you or your browser) and, like any web server, your IP address. It keeps:
  - **The answers**, in Cloudflare's cache for up to 30 days, keyed by a
    one-way hash of the request, so a table another reader already asked about
    is answered without asking again. The table text itself is not stored.
  - **Today's request count for each install id** and the day's total, to
    enforce the daily allowance. Each day's counts are deleted two days later.
  - Your IP address is used only by Cloudflare's rate limiter, for about a
    minute, and is not stored by the Worker.

  - **Anonymous counts** of requests, in Cloudflare Workers Analytics
    Engine for three months: for each request, whether it was answered from
    the cache, answered by the model, or refused and why; the input tokens it
    used; and how many requests its install had made that day. They have no
    install id, IP address, location, or table text. They show how much the
    endpoint is used and whether it is abused.

  Nothing is logged. The Worker, its cache, and the counts run on
  Cloudflare, under
  [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
  The table text goes to TypeSafe and to no one else.
- **TypeSafe** (Jev, with your own key), at `api.typesafe.ai`, under
  [TypeSafe's terms and privacy policy](https://typesafe.ai).
- **Cloudflare** (Clef on Workers AI, with your own token), at
  `api.cloudflare.com`, under
  [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

With your own key or token, the extension's author receives nothing. The
extension has no analytics, telemetry or crash reports with any provider.

## What is stored, and where

All in your browser's extension storage, on your device:

- **A random install id**, sent only to the free endpoint.
- **Your API key or token**, if you entered one in the options. It is read only by the
  extension's own pages and background worker and sent only to the provider
  you chose. Web pages and the scripts that run on them can't read it.
- **Cached model answers**, so an unchanged table is not sent twice. The
  cache is capped; the oldest entries are evicted. Options has a button to
  clear it.
- **Your settings**: palette, mode, and the sites you turned on or off.
- **For the current browser session only**: pages you paused and per-table
  choices (rows or columns, hidden).

## Your controls

- **Use your own key** instead of the free endpoint, so table text goes
  straight to the provider you pay.
- **Turn a site off**, or switch to **Only sites I turn on** so nothing is
  sent unless you enable a site. Do this for pages with private data.
- **Pause a page** from the toolbar popup or with <kbd>⌥⇧H</kbd>.
- **Clear cached answers** in the options.
- **Uninstall** to remove everything the extension stored.

Sites can opt out for all users with
`<meta name="practical-data" content="off">`.

## Changes

Changes to this policy will be noted here with a new date.

- October 21, 2026: the free endpoint keeps anonymous request counts.
