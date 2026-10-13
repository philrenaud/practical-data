# Practical Data for Google Sheets

A prototype Google Sheets add-on that shades a table in a sheet the way the
extension shades a table on a web page. It writes Sheets' own conditional
formatting, so the shading follows the data as it's edited, other people
see it, and anyone can adjust it in **Format → Conditional formatting**.

## How it works

1. **Extensions → Practical Data → Shade this table** reads the selection, or
   the whole block of data around a single selected cell. The first row is
   the header row.
2. The table's text (as displayed) goes to `api.practicaldata.dev/v1/judge`
   with a random per-account install id. The server runs the same judge as
   the extension (docs/hosted-api.md), within the same free allowance.
3. `src/sheets/plan.ts` turns the judgment into formatting:
   - **Numbers:** one color-scale rule per column, with min, mid and max
     points at the judged domain. Colors are flipped where lower is better,
     and the mid point is the geometric mean on log-scaled columns.
   - **Ordered labels** ("Lightweight < Versatile < Powerful"): one "text is
     exactly" rule per level.
   - **Numbers stored as text** ("829.8 m"): a color scale can't read these,
     so each cell is filled directly, and its earlier background is kept so
     removal can restore it.
   - **Totals:** rows the judge marks as totals or averages are left out.
   - **Row-oriented tables** (benchmarks × models) are shaded across rows.
4. **Remove shading from this sheet** removes only what the add-on added,
   which it records in the sheet's developer metadata. A rule whose range has
   since moved (rows inserted above it) is no longer recognized and is left in
   place; delete it in the conditional formatting panel.
5. **Colors** picks the palette, as in the extension's options. The default
   is Calm.

The Apps Script side is `src/sheets/addon.ts`. Its Apps Script types are
declared in `src/sheets/apps-script.d.ts` rather than taken from a package.

## Try it

The add-on calls the hosted endpoint, so the Worker must be deployed first
(Apps Script can't reach a local `wrangler dev`).

```sh
npm run sheets:build          # → dist-sheets/Code.js and appsscript.json
```

1. Open a Google Sheet, then **Extensions → Apps Script**.
2. Replace `Code.gs` with the contents of `dist-sheets/Code.js`.
3. In **Project Settings**, tick **Show "appsscript.json" manifest file in
   editor**, then replace that file with `dist-sheets/appsscript.json`.
4. Save, reload the sheet, and find **Extensions → Practical Data**. Google
   asks for permission the first time.

This binds the add-on to that one sheet. To use it across sheets without
publishing, deploy it as a test add-on: **Deploy → Test deployments →
Editor add-on**.

```sh
npm run sheets:preview        # draws fixture tables as a sheet would show them
```

The preview needs no network or Google account. It judges fixture tables
from recordings and writes `artifacts/sheets-preview.html` and `.png`.

## Publishing

Add-ons are listed on the Google Workspace Marketplace. Publishing needs:

- a Google Cloud project linked to the script, with the Marketplace SDK
  enabled and a store listing (icons, screenshots, privacy policy and terms
  URLs);
- OAuth verification for the scopes in `appsscript.json`:
  `spreadsheets.currentonly`, `script.container.ui` and
  `script.external_request`. `currentonly` limits the add-on to the sheet it
  is used in;
- a privacy policy section for the add-on. PRIVACY.md covers the extension
  only so far; it needs to say that the add-on sends the selected table's
  text to practicaldata.dev.

## Not done yet

- A sidebar showing the legend and why each column was or wasn't shaded. The
  add-on only reports this in a toast today.
- Bring-your-own-key, which would need the judge to run in Apps Script.
  Effect's runtime expects timers that Apps Script doesn't have.
- Excel (Office Add-ins). The same plan would map onto Office.js conditional
  formats.
