<!-- The home page. The extension's painter shades the recorded examples. -->
<script lang="ts">
  import { DEFAULT_PALETTE, divergingStops, PALETTES, type PaletteId } from "../../../../src/core/palettes.ts";
  import { config } from "../../../../package.json";
  import { track } from "#lib/analytics.ts";
  import Example from "#lib/Example.svelte";
  import { sections } from "#lib/demo.ts";
  import HeroGrid from "#lib/HeroGrid.svelte";

  const { data } = $props();
  const storeUrl = config.storeUrl;

  let view = $state<"colored" | "original">("colored");
  let palette = $state<PaletteId>(DEFAULT_PALETTE);
  let theme = $state<"auto" | "light" | "dark">("auto");
  let systemDark = $state(false);
  // Each swatch shows the ramp for the current theme. The theme effect recomputes them.
  let swatches = $state<Record<string, string>>({});
  // The theme applied to the page, or "" before the first apply. The tables paint only
  // after it is set, so that the painter blends over the new background colors.
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
    // The theme toggle applies only to this page. Remove it so that other pages open in Auto.
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
  <HeroGrid />
  <div class="hero-inner">
    <h1>Every table on the web <br class="wide" />becomes a data visualization.</h1>
    <p class="lede">
      <span class="brand"><img src="icon128.png" alt="" width="22" height="22" /> Practical Data</span>
      is a Chrome Extension that applies <span class="conditional high">conditional</span>
      <span class="conditional low">formatting</span> for data tables as you browse. It does tricky stuff automatically, like
      figuring out which direction is "better", or how to parse messy data, using a decision model.
    </p>
    <div class="actions">
      <a class="button primary" href={storeUrl} onclick={() => track("store_click", { placement: "hero" })}
        >Add to Chrome</a
      >
      <a class="button" href="https://github.com/philrenaud/practical-data"
        ><svg class="gh" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"
          ><path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          /></svg
        >GitHub</a
      >
    </div>
    <a class="proof" href="/tests"><span>Docs and tests</span></a>
    <a class="proof" href="#what-happens"><span>How it works TLDR</span></a>
    <a class="proof" href="/about"><span>About this project</span></a>
  </div>
</header>

<nav class="controls" aria-label="Display options">
  <div class="segmented" role="radiogroup" aria-label="View">
    <label><input type="radio" name="view" value="colored" bind:group={view} /><span>Shaded</span></label>
    <label><input type="radio" name="view" value="original" bind:group={view} /><span>Original</span></label>
  </div>
  <div class="control-group">
    <div class="palettes" id="palettes" role="radiogroup" aria-label="Palette">
      {#each palettes as [id, spec] (id)}
        <label title={spec.note}>
          <input type="radio" name="palette" value={id} bind:group={palette} />
          <span class="swatch" style:background={swatches[id]}></span>
          <span class="name">{spec.label}</span>
        </label>
      {/each}
    </div>
  </div>
  <button
    class="theme-toggle"
    role="switch"
    aria-checked={dark}
    onclick={() => (theme = dark ? "light" : "dark")}
    aria-label="Dark theme"
    title={theme === "auto" ? "Following the system theme" : dark ? "Dark" : "Light"}
  >
    <span class="knob" class:dark>
      {#if dark}
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.6 14.9A8.9 8.9 0 1 1 9.1 3.4a7.2 7.2 0 1 0 11.5 11.5Z" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="5" />
          <path
            d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2M4.6 4.6l2.3 2.3M17.1 17.1l2.3 2.3M19.4 4.6l-2.3 2.3M6.9 17.1l-2.3 2.3"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          />
        </svg>
      {/if}
    </span>
  </button>
</nav>

<main>
  <section id="examples" class="examples" aria-labelledby="examples-title">
    <h2 id="examples-title" class="sr-only">Examples</h2>
    {#each sections as section, i (section.section.id)}
      <Example {section} {palette} colored={view === "colored"} theme={applied} />
    {/each}
  </section>

  <section class="how" id="what-happens" aria-labelledby="how-title">
    <h2 id="how-title">How it works (TLDR)</h2>
    <ol class="steps">
      <li>
        <h3>1. Read the page</h3>
        <p>
          When you scroll a table into view, the extension figures out if it's got data or not. If it does, the
          extension standardizes its values (for parsing; your view of it doesn't change): Things like <code
            >$0.025</code
          >, <code>.312</code>, <code>6' 6"</code>, <code>1.5B</code>, <code>$50–60K</code>, <code>2:59</code>,
          <code>≤ 272K</code>, etc.
        </p>
      </li>
      <li>
        <h3>2. Reason about the data</h3>
        <p>
          A System One model (<a href="https://typesafe.ai">Jev</a>) answers narrow questions with probabilities:
        </p>
        <ul class="questions">
          <li>Is this column an amount? an identifier? a timestamp? a rank?</li>
          <li>Is a higher value better, worse, or neither?</li>
          <li>Does it make sense to show it in linear or log scale?</li>
          <li>Is this row a total, or part of the data?</li>
          <li>Do same-named columns in other tables share a scale?</li>
          <li>Are values compared down each column, or across each row?</li>
        </ul>
      </li>
      <li>
        <h3>3. Paint the table</h3>
        <p>
          The extension uses D3 to map each value onto a colour scale and applies it over the page's own background.
        </p>
      </li>
    </ol>
    <ul>
      <li>
        If you bring your own Jev or Clef key, the extension sends the data to the provider directly. If not, it sends
        it to an intermediary Cloudflare worker with a (daily limited, but these things are pretty cheap!) Jev API key.
        I don't retain anything either way (<a href="/privacy">Privacy policy</a>)
      </li>
      <li>
        Nothing is sent on sites you turn off. The toolbar popup turns a page or a whole site off, and <kbd>⌥⇧H</kbd> pauses
        the current page.
      </li>
      <li>A typical page costs about a tenth of a cent on your own key (or mine).</li>
    </ul>
  </section>

  <section class="open" id="open-source" aria-labelledby="open-title">
    <div class="open-head">
      <h2 id="open-title">Open Source (MIT)</h2>
      <p>
        You can Bring Your Own Key (BYOK) for Jev or Clef, or use the extension without a key (with a usage-limited free
        endpoint). System one models are pretty cheap :)
      </p>
    </div>
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
        > View source on GitHub</a
      >
      <a href="/tests">See the core data tests</a>
      <a href="https://github.com/philrenaud/practical-data/issues">Report a misread table</a>
      <a href="https://github.com/philrenaud/practical-data/blob/main/docs/decisions.md"
        >A bit about how the questions are designed</a
      >
    </p>
  </section>

  <section class="install" id="install" aria-labelledby="install-title">
    <h2 id="install-title">Install</h2>
    <ol>
      <li>
        Install <a href={storeUrl} onclick={() => track("store_click", { placement: "install" })}
          >Practical Data from the Chrome Web Store</a
        >.
      </li>
      <li>
        It works without a key. To use your own, paste a <a href="https://typesafe.ai">TypeSafe</a> or
        <a href="https://developers.cloudflare.com/workers-ai/models/clef/">Clef</a> API key on the options page.
      </li>
    </ol>
  </section>
</main>

<footer>
  <p class="brand footer-brand">
    <img src="icon128.png" alt="" width="22" height="22" /> Practical Data
  </p>
  <p class="signoff">
    Smart conditional formatting for every table on the web. Shading on this page comes from an offline recording using
    jev-1.13.0.
  </p>
  <p>
    <a href="/tests">Tests</a>
    · <a href="/about">About</a> · <a href="/privacy">Privacy policy</a> ·
    <a href="https://github.com/philrenaud/practical-data">Source on GitHub</a>
  </p>
</footer>
