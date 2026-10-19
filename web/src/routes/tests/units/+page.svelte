<script lang="ts">
  import Verdict from "#lib/tests/Verdict.svelte";

  const { data } = $props();

  /** What each test file covers, by the module it tests. */
  const ABOUT: Readonly<Record<string, string>> = {
    "allow.test.ts": "The free endpoint accepts each request that the extension sends on the test pages. It refuses all other requests.",
    "allowance.test.ts": "The free daily allowance as the reader sees it: the requests that remain, the reset time, and the text.",
    "judge.test.ts": "The judge, with answers supplied by code. Code ignores identifiers and two-level labels. Shared scales. One failed table does not stop the other tables.",
    "legend.test.ts": "The card that shows when you put the pointer on a header: ranges and units for shared, log, ranked, and duration columns, and the totals that are not on the scale.",
    "model.test.ts": "Validation of answers, and the quota and allowance values from the free endpoint.",
    "order.test.ts": "The label order from pair answers, also when some answers disagree.",
    "orient.test.ts": "Row-based tables, read one row at a time.",
    "parse.test.ts": "Cell text to numbers: currencies, percentages, suffixes, durations, ranges, and bounds. Also the text that must not become a number.",
    "profile.test.ts": "Column profiles: kind, spread, unit, ranks, years, and label order. Dates stay out.",
    "scale.test.ts": "Values to positions to colors, for each palette.",
    "tint.test.ts": "Colors on the page background. For each palette, step, and page, the text contrast stays at 5:1 or more. If not, the cell is not shaded.",
  };
  const total = $derived(data.units.reduce((n, u) => n + u.tests.length, 0));
  const failed = $derived(data.units.reduce((n, u) => n + u.tests.filter((t) => !t.ok).length, 0));
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(Math.round(n * 1000) / 1000));
</script>

<svelte:head>
  <title>Unit tests · Tests · Practical Data</title>
</svelte:head>

<h1>Unit tests and parsing</h1>
<p class="lede-docs">Code makes many decisions before and after the model. These tests check that code. The results are from the build of this site.</p>
<p class="score"><strong>{total - failed} of {total}</strong> unit tests pass.</p>

<h2>Parsing</h2>
<p>The parser changes cell text into numbers. Each row below is the output of <code>parseNumber</code> during the build. Text that is not clear becomes no number, thus it cannot change a scale.</p>
<div class="scroll-x">
  <table class="list parse">
    <thead><tr><th scope="col">Cell text</th><th scope="col" class="num">Value</th><th scope="col">Unit</th><th scope="col">Result</th></tr></thead>
    <tbody>
      {#each data.parsing as x (x.input)}
        <tr>
          <th scope="row"><code>{x.input}</code></th>
          <td class="num">{x.parsed === null ? "" : fmt(x.parsed.value)}</td>
          <td class="mono">{x.parsed?.unit === ":" ? "m:ss" : (x.parsed?.unit ?? "")}</td>
          <td class="muted">
            {#if x.missing}No value
            {:else if x.parsed === null}{x.date ? "A date, not an amount" : "Not a number"}
            {:else if x.parsed.range}Range from {fmt(x.parsed.range[0])} to {fmt(x.parsed.range[1])}; the value is the midpoint
            {:else if x.parsed.unit === ":"}A clock value. The model decides if it is a duration or a time of day
            {:else if x.parsed.bound}A limit, not an exact amount
            {:else}Amount{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<h2>Test files</h2>
{#each data.units as u (u.file)}
  <section class="file">
    <h3><code>{u.file}</code> <span class="muted">{u.tests.filter((t) => t.ok).length} of {u.tests.length}</span></h3>
    {#if ABOUT[u.file]}<p class="about">{ABOUT[u.file]}</p>{/if}
    <table class="list tests">
      <tbody>
        {#each u.tests as t, i (i)}
          <tr>
            <td class="v">{#if t.skipped}<span class="verdict known">Skipped</span>{:else}<Verdict ok={t.ok} />{/if}</td>
            <td>{t.name}</td>
            <td class="num">{t.ms < 1 ? "<1" : Math.round(t.ms)} ms</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/each}

<style>
  .score { margin: 24px 0 0; font-size: 18px; }
  .parse th[scope="row"] code { font: 13.5px var(--mono); }
  .file { margin-top: 40px; }
  .file h3 { margin: 0; font-size: 17px; font-weight: 650; }
  .file h3 code { font: 600 15px var(--mono); }
  .file h3 .muted { font-weight: 400; font-size: 14px; margin-left: 8px; }
  .about { margin: 6px 0 10px; color: var(--muted); }
  .tests td { padding-top: 7px; padding-bottom: 7px; overflow-wrap: anywhere; }
  .tests .v { width: 7em; }
  .tests .num { color: var(--faint); }
</style>
