<!-- practicaldata.dev home: recorded examples shaded by the extension's own painter. -->
<script lang="ts">
  import { DEFAULT_PALETTE, divergingStops, PALETTES, type PaletteId } from "../../../../src/core/palettes.ts";
  import { config } from "../../../../package.json";
  import Example from "#lib/Example.svelte";
  import { sections } from "#lib/demo.ts";

  const { data } = $props();
  const storeUrl = config.storeUrl;

  let view = $state<"colored" | "original">("colored");
  let palette = $state<PaletteId>(DEFAULT_PALETTE);
  let theme = $state<"auto" | "light" | "dark">("auto");
  let systemDark = $state(false);
  // Swatches show the ramp the page will actually use; recomputed when the theme changes.
  let swatches = $state<Record<string, string>>({});
  // The theme as applied to the page ("" until then). Tables paint once it is set and
  // repaint when it changes, only after the page's colors have switched, since the
  // painter blends over the backgrounds it finds.
  let applied = $state("");

  const palettes = Object.entries(PALETTES) as [PaletteId, (typeof PALETTES)[PaletteId]][];
  const dark = $derived(theme === "dark" || (theme === "auto" && systemDark));

  $effect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    systemDark = query.matches;
    const change = () => (systemDark = query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  });

  $effect(() => {
    if (theme === "auto") delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = theme;
    const mid = getComputedStyle(document.body).getPropertyValue("--paper").trim() || "#fff";
    swatches = Object.fromEntries(
      palettes.map(([id]) => [id, `linear-gradient(90deg, ${divergingStops(id, dark, mid).join(", ")})`]),
    );
    applied = dark ? "dark" : "light";
    // The page theme is this page's control; other pages open in Auto.
    return () => delete document.documentElement.dataset["theme"];
  });
</script>

<svelte:head>
  <title>Practical Data</title>
  <meta
    name="description"
    content="A free, open-source Chrome extension that shades the comparable columns of any HTML table, using a decision model to judge which way is better."
  />
</svelte:head>

<header class="hero">
  <div class="hero-inner">
    <p class="eyebrow">
      <img src="icon128.png" alt="" width="22" height="22" /> Practical Data
      <span class="tag">Free &amp; open source</span>
    </p>
    <h1>Tables you can read <br class="wide" />at a glance.</h1>
    <p class="lede">
      Conditional formatting for every table on the web, with the direction figured out for you. A Chrome extension that
      shades the comparable columns of any HTML table, so the better and worse rows show without reading every cell.
    </p>
    <div class="actions">
      <a class="button primary" href={storeUrl}>Add to Chrome</a>
      <a class="button" href="https://github.com/philrenaud/practical-data"
        ><svg class="gh" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"
          ><path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          /></svg
        > Source on GitHub</a
      >
    </div>
    <a class="proof" href="/tests"
      ><strong>{data.tests.passed} of {data.tests.total}</strong> hand-labeled checks on real tables pass.
      <span>See the core data tests</span></a
    >
  </div>
</header>

<nav class="controls" aria-label="Display options">
  <div class="segmented" role="radiogroup" aria-label="View">
    <label><input type="radio" name="view" value="colored" bind:group={view} /><span>Shaded</span></label>
    <label><input type="radio" name="view" value="original" bind:group={view} /><span>Original</span></label>
  </div>
  <div class="control-group">
    <span class="control-label" id="palette-label">Palette</span>
    <div class="palettes" id="palettes" role="radiogroup" aria-labelledby="palette-label">
      {#each palettes as [id, spec] (id)}
        <label title={spec.note}>
          <input type="radio" name="palette" value={id} bind:group={palette} />
          <span class="swatch" style:background={swatches[id]}></span>
          <span class="name">{spec.label}</span>
        </label>
      {/each}
    </div>
  </div>
  <div class="control-group">
    <span class="control-label" id="theme-label">Page</span>
    <div class="segmented" role="radiogroup" aria-labelledby="theme-label">
      <label><input type="radio" name="theme" value="auto" bind:group={theme} /><span>Auto</span></label>
      <label><input type="radio" name="theme" value="light" bind:group={theme} /><span>Light</span></label>
      <label><input type="radio" name="theme" value="dark" bind:group={theme} /><span>Dark</span></label>
    </div>
  </div>
  <a class="hint-link" href="/palettes" data-sveltekit-reload>Palette study</a>
  <p class="hint">
    Hover a shaded header to see how it was read. Switch the page to dark: the shading picks its dark ramps on its own.
  </p>
</nav>

<main>
  <section id="examples" class="examples" aria-labelledby="examples-title">
    <h2 id="examples-title" class="sr-only">Examples</h2>
    {#each sections as section, i (section.section.id)}
      <Example {section} index={i} {palette} colored={view === "colored"} theme={applied} />
    {/each}
  </section>

  <section class="how" aria-labelledby="how-title">
    <h2 id="how-title">How it works</h2>
    <ol class="steps">
      <li>
        <h3>Read</h3>
        <p>
          Code extracts each table, resolves merged cells, and parses values: <code>$0.025</code>, <code>.312</code>,
          <code>6' 6"</code>, <code>1.5B</code>, <code>20–25</code>, <code>2:59</code>, <code>≤ 272K</code>. A
          <code>2:41</code>
          game length is a duration; a <code>7:05</code> start time is not. It computes the ranges and spreads, and describes
          them in words.
        </p>
      </li>
      <li>
        <h3>Judge</h3>
        <p>
          A System One model (<a href="https://typesafe.ai">Jev</a>) answers narrow, typed questions with probabilities:
        </p>
        <ul class="questions">
          <li>Is this column an amount, an identifier, a time, a rank, or a cutoff?</li>
          <li>Is a higher value better, worse, or neither?</li>
          <li>Do ratios matter more than differences (log scale)?</li>
          <li>Are these labels ordered grades? Which of two is the lower grade?</li>
          <li>Is this row a total? Do same-named columns in other tables share a scale?</li>
          <li>Are values compared down each column, or across each row?</li>
        </ul>
      </li>
      <li>
        <h3>Paint</h3>
        <p>
          D3 maps each value onto a ColorBrewer scale and blends it over the page's own background. Every cell keeps
          WCAG AA text contrast, and the extension restores the page exactly when you turn it off.
        </p>
      </li>
    </ol>
    <dl class="stats">
      <div>
        <dt>165 / 165</dt>
        <dd>
          hand-labeled columns shaded or left plain correctly, across 21 test pages (a regression check, not an accuracy
          estimate)
        </dd>
      </div>
      <div>
        <dt>81 / 81</dt>
        <dd>directions of "better" judged correctly</dd>
      </div>
      <div>
        <dt>~$0.001</dt>
        <dd>typical cost to judge a page; repeat visits are free</dd>
      </div>
    </dl>
  </section>

  <section class="open" id="open-source" aria-labelledby="open-title">
    <div class="open-head">
      <h2 id="open-title">Open source, top to bottom.</h2>
      <p>
        Practical Data is MIT-licensed. The extension, the questions it asks the model, the test pages and the recorded
        answers are all on GitHub.
      </p>
    </div>
    <ul class="open-points">
      <li>
        <h3>Read what you install</h3>
        <p>
          The store package is built unminified from the same repository, so the code running in your browser reads like
          the source.
        </p>
      </li>
      <li>
        <h3>Your key, or soon none at all</h3>
        <p>
          With your own key, table text goes straight to your provider and nothing passes through the author. From
          1.1.0, a free endpoint judges tables without a key and keeps only the answers. No analytics, no telemetry. <a
            href="/privacy">Privacy policy</a
          >
        </p>
      </li>
      <li>
        <h3>Check the claims yourself</h3>
        <p>
          One command replays every recorded judgment offline: unit tests, the hand-labeled eval, and 21 pages in a real
          browser. No key needed.
        </p>
      </li>
    </ul>
    <div class="terminal" role="group" aria-label="Run the test suite">
      <pre><code
          ><span class="prompt">$</span> git clone https://github.com/philrenaud/practical-data
<span class="prompt">$</span> cd practical-data &amp;&amp; npm install
<span class="prompt">$</span> npx playwright install chromium
<span class="prompt">$</span> npm run check</code
        ></pre>
    </div>
    <p class="open-links">
      <a class="text-button" href="https://github.com/philrenaud/practical-data"
        ><svg class="gh" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"
          ><path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          /></svg
        > View the source on GitHub</a
      >
      <a href="/tests">See the core data tests</a>
      <a href="https://github.com/philrenaud/practical-data/issues">Report a misread table</a>
      <a href="https://github.com/philrenaud/practical-data/blob/main/docs/decisions.md"
        >How the questions are designed</a
      >
    </p>
  </section>

  <section class="install" id="install" aria-labelledby="install-title">
    <h2 id="install-title">Install</h2>
    <ol>
      <li>Install <a href={storeUrl}>Practical Data from the Chrome Web Store</a>.</li>
      <li>
        Paste a <a href="https://typesafe.ai">TypeSafe</a> API key on the options page, which opens when it's installed. The
        next version, 1.1.0, works without a key.
      </li>
    </ol>
    <p class="note">
      Tables are judged as they scroll into view, up to 200 per page. Table text (headers, sample values, a few rows) is
      sent to be judged, straight to your own provider (or, from 1.1.0, through the free endpoint); nothing is sent for
      sites you turn off. A typical page costs about a tenth of a cent on your own key. From 1.1.0, the free endpoint
      has a daily allowance per browser, and a key gives unlimited use. The toolbar popup turns a page or a whole site
      off, and ⌥⇧H toggles the current page.
    </p>
  </section>
</main>

<footer>
  <p>
    Shading on this page comes from recorded judgments of real tables, applied by the extension's own code. <a
      href="/tests">Tests</a
    >
    · <a href="/privacy">Privacy policy</a> ·
    <a href="https://github.com/philrenaud/practical-data">Source on GitHub</a>
    · <a href="https://github.com/philrenaud/practical-data/blob/main/LICENSE">MIT license</a>
  </p>
</footer>
