<script lang="ts">
  import Verdict from "#lib/tests/Verdict.svelte";

  const { data } = $props();

  /** What each test file covers, by the module it tests. */
  const ABOUT: Readonly<Record<string, string>> = {
    "allow.test.ts": "The free endpoint's allowlist: every request the extension sends on the test pages is accepted, and anything else is refused.",
    "allowance.test.ts": "The free allowance as the reader sees it: what's left, when it resets, and the wording.",
    "judge.test.ts": "The judging program with answers supplied in code: identifiers declined, two-level labels dropped, shared scales, and one failure leaving the rest of the page judged.",
    "legend.test.ts": "The hover card: extents and units for shared, log-scaled, ranked and duration columns, and excluded totals.",
    "model.test.ts": "Answer validation, and the free endpoint's quota and allowance reporting.",
    "order.test.ts": "Recovering a label order from pairwise answers, including contradictory ones.",
    "orient.test.ts": "Transposing row-oriented tables.",
    "parse.test.ts": "Cell text to numbers: currencies, percentages, suffixes, durations, ranges, bounds, and what must not parse.",
    "profile.test.ts": "Column profiling: kinds, spread, units, rank and year hints, label order, and dates kept out.",
    "scale.test.ts": "Values to positions to colors, for every palette.",
    "tint.test.ts": "Blending colors over the page: for every palette, step and page, text stays at 5:1 contrast or the cell is left plain.",
  };
  const total = $derived(data.units.reduce((n, u) => n + u.tests.length, 0));
  const failed = $derived(data.units.reduce((n, u) => n + u.tests.filter((t) => !t.ok).length, 0));
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(n * 1000) / 1000));
</script>

<svelte:head>
  <title>Unit tests · Tests · Practical Data</title>
</svelte:head>

<p class="eyebrow-mono">Code · {total - failed}/{total} pass</p>
<h1>Unit tests and parsing</h1>
<p class="lede-docs">The deterministic half: everything code decides before and after the model. Results below are from running the suite when this site was built.</p>

<h2>Parsing, live</h2>
<p class="muted">Cell text as the parser reads it. Each row was computed by <code class="code-inline">parseNumber</code> when the site was built. Anything ambiguous parses to nothing, so it never pollutes a scale.</p>
<div class="scroll-x">
  <table class="list parse">
    <thead><tr><th>Cell</th><th class="num">Value</th><th>Unit</th><th>Read as</th></tr></thead>
    <tbody>
      {#each data.parsing as x (x.input)}
        <tr>
          <td><code class="code-inline cell">{x.input}</code></td>
          <td class="num">{x.parsed === null ? "—" : fmt(x.parsed.value)}</td>
          <td class="mono">{x.parsed?.unit === ":" ? "m:ss" : (x.parsed?.unit ?? "")}</td>
          <td class="muted">
            {#if x.missing}missing value
            {:else if x.parsed === null}{x.date ? "a date: not an amount" : "not a number"}
            {:else if x.parsed.range}range {fmt(x.parsed.range[0])} to {fmt(x.parsed.range[1])}, midpoint
            {:else if x.parsed.unit === ":"}a clock reading: a duration or a time of day, the model decides
            {:else if x.parsed.bound}a bound, not an exact amount
            {:else}amount{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<h2>The suite</h2>
<div class="files">
  {#each data.units as u (u.file)}
    <section class="card file">
      <header>
        <h3 class="mono">{u.file}</h3>
        <span class="mono muted">{u.tests.filter((t) => t.ok).length}/{u.tests.length}</span>
      </header>
      {#if ABOUT[u.file]}<p class="muted about">{ABOUT[u.file]}</p>{/if}
      <ul>
        {#each u.tests as t, i (i)}
          <li>{#if t.skipped}<span class="verdict known">skipped</span>{:else}<Verdict ok={t.ok} />{/if}<span>{t.name}</span><span class="ms">{t.ms < 1 ? "<1" : Math.round(t.ms)} ms</span></li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .parse .cell { background: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; }
  .files { display: grid; gap: 12px; }
  .file header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .file h3 { font-size: 14px; font-weight: 500; }
  .about { margin: 6px 0 10px; font-size: 14px; }
  .file ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .file li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 10px; font-size: 14px; }
  .file li span:nth-child(2) { overflow-wrap: anywhere; }
  .ms { font: 12px var(--mono); color: var(--faint); }
</style>
