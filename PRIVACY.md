# Privacy policy

_Practical Data, a Chrome extension. Last updated October 5, 2026._

Practical Data shades the comparable columns of tables on web pages. To decide
what each column means, it asks a decision model run by a third-party
provider that you choose and pay for directly. This page says exactly what
that involves.

## What leaves your browser

When a table comes within about a screen of the viewport on a site where the
extension is on, the extension sends this to your chosen provider:

- The page title.
- The table's caption or nearest heading, and its column headers.
- A few sample values from each column, and the distinct labels in label
  columns (for example `Lightweight`, `Versatile`, `Powerful`).
- The first and last two rows, to check whether they are totals.

It does **not** send the page URL, cookies, form contents, text outside
tables, or anything from tables you never scroll near.

## Who receives it

Only the provider you configure in the extension's options:

- **TypeSafe** (Jev), at `api.typesafe.ai`, under
  [TypeSafe's terms and privacy policy](https://typesafe.ai).
- **Cloudflare** (Clef, on Workers AI), at `api.cloudflare.com`, under
  [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

The extension's author does not run a server and receives nothing: no
analytics, no telemetry, no crash reports.

## What is stored, and where

All in your browser's extension storage, on your device:

- **Your API key or token**, entered in the options. It is read only by the
  extension's own pages and background worker and sent only to the provider
  you chose. Web pages and the scripts that run on them can't read it.
- **Cached model answers**, so an unchanged table is not sent twice. The
  cache is capped; the oldest entries are evicted. Options has a button to
  clear it.
- **Your settings**: palette, mode, and the sites you turned on or off.
- **For the current browser session only**: pages you paused and per-table
  choices (rows or columns, hidden).

## Your controls

- **Turn a site off**, or switch to **Only sites I turn on** so nothing is
  sent unless you enable a site. Do this for pages with private data.
- **Pause a page** from the toolbar popup or with <kbd>⌥⇧H</kbd>.
- **Clear cached answers** in the options.
- **Uninstall** to remove everything the extension stored.

Sites can opt out for all users with
`<meta name="practical-data" content="off">`.

## Changes

Changes to this policy will be noted here with a new date.
