# src/ext

This directory holds the Chrome MV3 extension. The table extraction, the
decision logic, and the painting live in `src/dom`, `src/decide`, and
`src/core`. The files here connect them to Chrome.

## Parts

| File | Runs in | Job |
| --- | --- | --- |
| `background.ts` | Service worker | Holds the credentials, calls the decision model, keeps the answer cache, and owns the page and site switches. |
| `content.ts` | Every http and https page | Extracts tables near the viewport, sends them to the worker, and paints the reply. Never reads extension storage. |
| `popup.ts` | Toolbar popup | Shows what is shaded on the current tab and has the page and site switches. |
| `options.ts` | Options page | Edits the provider, credentials, palette, and site list. **Test** sends one built-in sample table to the model. |
| `settings.ts` | Worker, popup, and options | Reads and writes `chrome.storage`. `content.ts` imports only the `TableChoice` type. |
| `cache.ts` | Worker | The answer cache in `storage.local`. |
| `pace.ts` | Content script | Limits the judge requests that page changes trigger. |
| `allowance.ts` | Worker and popup | Merges the free endpoint's reported counts and builds the popup's allowance messages. |
| `messages.ts` | All | The message types. |
| `flags.ts` | Worker and content script, dev build only | Captures a flagged table and files it as an issue. See [Flags](#flags-dev-build-only). |

## Messages

All messages use `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.
The manifest has no `externally_connectable` key, so web pages and other
extensions can't send them.

| Message | From | To | Effect |
| --- | --- | --- | --- |
| `pageConfig` | content | worker | Returns `PageConfig`, which says whether the page is on and carries its saved table choices. Sent at start-up and after in-app navigation. |
| `saveTableChoices` | content | worker | Saves the page's table choices for the browser session. |
| `judge` | content | worker | Returns `JudgeReply`, with the judgment and the palette or an error reason. |
| `setPagePaused` | popup | worker | Pauses or resumes one page for the browser session. |
| `setSiteEnabled` | popup | worker | Turns a host on or off in the saved settings. |
| `toggle` | worker | content | Turns shading on or off now. |
| `repaint` | worker | content | Runs the page again with `force`, after a settings change. |
| `state` | popup | content | Returns `PageState`, with the URL, the status, and the counts of shaded tables and columns. |
| `flag` | content | worker | Dev build only. Files a flag and returns `FlagReply`. |
| `flagAt` | worker | content | Dev build only. Flags the table under the last right-click. |

The worker's `onMessage` listener checks `sender.id`. It accepts `judge` only
from a tab. It accepts `pageConfig` and `saveTableChoices` only for a URL with
the sender's origin, so a content script reaches only its own site's session
state. It accepts the two switches only from a sender URL under the
extension's origin. A content script runs inside a web page, so the worker
never takes a switch from one.

## Permissions

| Manifest entry | Reason |
| --- | --- |
| `storage` | Settings, the install id, the answer cache, and the session state. |
| `activeTab` | The popup and the `toggle-page` shortcut need the current tab's id and URL. `activeTab` grants them only after a user gesture. The broader `tabs` permission would expose every tab's URL. |
| `host_permissions` for the three API origins | The worker and the options page call `api.practicaldata.dev`, `api.typesafe.ai`, and `api.cloudflare.com`. The extension calls no other origin. |
| `content_scripts` on `http://*/*`, `https://*/*` | Tables are shaded without a click. The content script makes no network requests. It sends table text only to the worker. |
| `commands.toggle-page` | <kbd>Alt+Shift+H</kbd> pauses or resumes the current page. |

The extension has no `scripting`, `tabs`, `cookies`, `webRequest`, or
`<all_urls>` host permission. The dev build adds `contextMenus` and
`<all_urls>`; see [Flags](#flags-dev-build-only).

## Storage

Only the worker and the extension pages read or write storage. The content
script gets what it needs in the `pageConfig` reply and saves table choices
with `saveTableChoices`.

| Area | Access level | Keys |
| --- | --- | --- |
| `storage.local` | `TRUSTED_CONTEXTS` | `settings` (provider, keys, palette, mode, host lists), `installId`, `allowance`, `answers:v2:<sha-256>`, `answers:v2:index` |
| `storage.session` | `TRUSTED_CONTEXTS` | `pausedPages` (URLs without fragments), `tables:<URL without fragment>` (per-table choices) |

`TRUSTED_CONTEXTS` means the worker and the extension's own pages.
`storage.session` has this level by default, and Chrome clears it when the
browser closes. `storage.local` is open to content scripts by default.
`background.ts` sets both areas to `TRUSTED_CONTEXTS` each time the worker
starts. Whether Chrome keeps the `storage.local` level across a browser
restart is unverified. If it does not, a content script that runs before the
worker starts could read `storage.local` during that window. `content.ts`
never reads it.

## What leaves the browser

Only the worker and the options page send requests, and only to the provider
in `settings.provider`. [PRIVACY.md](../../PRIVACY.md) lists the fields. In
short, a request carries the page title, table captions and headers, and
sample cell values. It never carries the page URL.

A table is sent only if all of these are true:

- The page is not opted out with `<meta name="practical-data" content="off">`.
- `siteEnabled` is true for the host. In `"chosen"` mode, every host is off
  until the user turns it on. In `"everywhere"` mode, a private host
  (`isPrivateHost`: localhost, a name with no dot, `.local`, `.internal`,
  `.lan`, `.corp`, `.home.arpa`, or a private IP address) is off until the
  user turns it on.
- The user has not paused the page in this session.
- The table has come within one viewport height of the screen. `content.ts`
  watches tables with an `IntersectionObserver` (`NEAR`) and extracts only
  those it has seen.
- The user has not hidden the table's shading.

`content.ts` caps a page at `MAX_TABLES` (200). The worker caps each request
at 200 tables and 10,000 rows per table, whatever the content script sends.

A page that changes its own tables, such as a live score or a ticker, sends
new text that misses the answer cache. `pace.ts` limits those requests. The
first change waits `CHANGE_DELAY_MS` (600 ms). Each change-triggered request
that sends new text doubles the wait, up to `CHANGE_DELAY_MAX_MS` (5 minutes).
After `CHANGE_RESET_MS` (1 minute) of quiet beyond the current wait, the wait
starts over. A table that changes every second therefore sends at most about
25 requests an hour, and its shading lags by up to 5 minutes. Scrolling a new
table into view and the per-table controls are not paced. A click on the
page's own sorter or expander counts as a page change.

The free provider adds the `X-Practical-Data-Install` header with the
`installId`, a `crypto.randomUUID` value. The other providers send the user's
key as a bearer token.

## Answer cache

`answerCache` in `cache.ts` stores each model response under the SHA-256 of
the exact request body. An unchanged table therefore costs no request on a
later visit. `model.ts` decodes and validates each entry on read, so a stale
or malformed entry is treated as a miss. The cache holds `CACHE_MAX` (1,500)
entries and evicts the oldest 300 when it is full. Writes run one at a time,
so concurrent writes can't drop keys from the index. Options has a
**Clear cached answers** button.

## Free-endpoint allowance

The free endpoint reports `x-practical-data-remaining` and
`x-practical-data-limit` on each response. `recordAllowance` stores the lowest
count seen today in `allowance`, using `mergeAllowance`. The popup shows
`lowAllowanceNote` when less than a fifth is left. It counts pages at
`REQUESTS_PER_PAGE` (12) requests each.

A spent allowance comes back as `x-practical-data-quota`. The worker then
stops sending for `QUOTA_COOL_DOWN_MS` (15 minutes) and sets the toolbar
badge to `!`. Rate limiting or overload stops sending for `COOL_DOWN_MS`
(30 seconds). Any settings change ends the cool-down.

## Build and load

```sh
npm install
npm run build        # writes dist/
npm run dev          # rebuilds dist/ on change
```

`scripts/build.ts` bundles `content.ts` as an IIFE and the other entry points
as ES modules. It copies `static/` into `dist/`. It stamps the git SHA and the
build time into `version_name`, which the popup and options pages show. The
bundle is not minified, so the code in `dist/` matches this source.
`PD_API_ORIGIN=http://localhost:8787` points the free provider at a local
`wrangler dev` and adds that origin to `host_permissions`.

To load the build, open `chrome://extensions`, turn on **Developer mode**,
click **Load unpacked**, and select `dist/`. After a rebuild, click the reload
icon on the extension's card.

## Test

```sh
npm test                    # unit tests in test/
npm run e2e -- --offline    # Chromium with dist/ loaded, replaying fixtures/recordings
npm run check               # format, typecheck, unit tests, build, eval, and offline e2e
```

`scripts/e2e.ts` loads `dist/` in a fresh Chromium profile and opens every page
in `fixtures/`. It checks that each page reaches `data-pd-status="done"`, that
painted text keeps a 4.5:1 contrast, and that turning shading off restores
the original markup. It also runs these scenarios:

- **navigation**: a paused page that navigates in-app to another page shades
  the new page, without polling.
- **storage**: the content script's world can read neither storage area and
  can't send a site switch.
- **live**: a table that changes every second sends at most 6 judge requests
  in 16 seconds.
- **cold start**: a page that loads while the worker starts still shades.
- **lifecycle**: in-place edits, inserted tables, page styles, and in-app
  navigation.
- **controls**: the per-table rows, columns, and hide buttons.
- **popup**: the page and site switches.

Without `--offline`, API calls go live and need `TYPESAFE_API_KEY`. Use
`--headed` to watch, and `--only <name>` to run matching pages.

## Design decisions

- **The worker holds the keys.** Content scripts run in pages, so they get
  judgments, not credentials.
- **Content scripts can't read extension storage.** Chrome enforces the rule
  above, with the restart caveat in [Storage](#storage). A compromised
  renderer can't read the keys or the list of paused URLs.
- **Tables are sent lazily.** Tables the user never scrolls near never leave
  the browser.
- **No `tabs` permission.** The content script reports its own URL in
  `PageState`, so the popup needs only `activeTab`.
- **Pauses and table choices live in `storage.session`.** They are meant for
  one sitting and are gone when the browser closes.
- **Navigation polling runs only on shaded pages.** Off pages rely on the
  Navigation API and `popstate`, so an off page costs no timer.
- **Table choices are keyed by content.** `fingerprint` hashes the headers and
  the first row, so a choice stays with its table when the page inserts
  another table above it.
- **The build is not minified.** Reviewers can read what runs.
- **Fonts ship in `static/fonts`.** The options page makes no third-party
  requests.

## Flags (dev build only)

`npm run build:dev` (or `npm run dev`, which watches) builds a field-test
copy named "Practical Data (dev)". It adds a **Flag as wrong** button to the
table controls and a **Flag this table as wrong** item to the right-click
menu. A flag files an issue in the private repository
`philrenaud/practical-data-flags` with:

- the table as the extractor reads it, and its outerHTML;
- the judgment that painted it, with the model's probabilities;
- the provider, the model, and the build;
- a screenshot of the visible tab.

The token is a GitHub fine-grained token with Contents and Issues write
access to that repository only. The options page of the dev build has a
field for it, which saves it in `storage.local` as `flagToken`.

The build defines `PD_FLAGS_REPO`. It is `null` in the store build, so the
bundler drops the GitHub code, and only inert `if (false)` blocks remain.
The dev build needs `contextMenus`, and `<all_urls>` so that the toolbar
button can take a screenshot without a user gesture on the extension. Never
upload a dev build to the store.

`npm run flags` pulls the open flags into `artifacts/flags/<id>/`. Flags
hold real page content, so they never go into `fixtures/` or this repository.
