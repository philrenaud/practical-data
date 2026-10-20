<script lang="ts">
  import { KINDS } from "#lib/tests/kinds.ts";

  const { data } = $props();
  const failing = $derived(data.checkCount - data.passCount);
  const knownFailing = $derived(Object.values(data.totals).reduce((n, t) => n + t.known, 0));
</script>

<svelte:head>
  <title>Tests · Practical Data</title>
  <meta
    name="description"
    content="How Practical Data tests its decisions: hand-labeled tables from real pages, recorded model answers, and checks that anyone can run again offline."
  />
</svelte:head>

<h1>How we test the decisions</h1>
<p class="lede-docs">
  The extension asks a decision model short questions about each table. The answers tell the extension which columns to
  shade and which direction is better.
</p>
<p>
  We copied the tables of {data.pages} public pages and gave hand labels to their columns. Each check compares one decision
  with its hand label. The checks use recorded answers, thus you can run them again without a model key:
  <code>npm run eval -- --offline</code>.
</p>

<p class="score">
  <strong>{data.passCount} of {data.checkCount}</strong> checks pass.
  {#if failing > 0}
    {failing === knownFailing
      ? `The ${failing === 1 ? "failure shows" : `${failing} failures show`}`
      : `${failing - knownFailing} ${failing - knownFailing === 1 ? "failure is" : "failures are"} not explained yet. The others show`}
    <a href="/tests/limitations"
      >{data.limitations === 1 ? "a known limitation" : `${data.limitations} known limitations`}</a
    > of the tool.
  {/if}
</p>

<h2>Checks</h2>
<div class="scroll-x">
  <table class="list kinds">
    <thead><tr><th scope="col">Check</th><th scope="col">Question</th><th scope="col" class="num">Pass</th></tr></thead>
    <tbody>
      {#each KINDS as k (k.kind)}
        {@const t = data.totals[k.kind]}
        <tr>
          <th scope="row"><a href="/tests/checks/{k.slug}">{k.title}</a></th>
          <td class="muted">{k.short}</td>
          <td class="num" class:bad={t.ok < t.total}>{t.ok} / {t.total}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<h2>More</h2>
<ul class="more">
  <li><a href="/tests/limitations">Known limitations</a>: what the tool does wrong, with examples.</li>
  <li><a href="/tests/glossary">Glossary</a>: each question, and what each answer means.</li>
  <li>
    <a href="/tests/sites">Sites to test against</a>: the public pages behind the checks. Open them with the extension.
  </li>
  <li><a href="/tests/units">Unit tests and parsing</a>: the code that runs before and after the model.</li>
</ul>
<p class="muted small">
  CI also runs {data.hidden} checks on {data.synthetic} synthetic pages, for layouts such as dark pages and tables that change
  after load. This site does not show them.
</p>

<style>
  .score {
    margin: 28px 0 0;
    font-size: 18px;
  }
  .kinds th[scope="row"] a {
    color: var(--ink);
    font-weight: 600;
    text-decoration: none;
  }
  .kinds th[scope="row"] a:hover {
    text-decoration: underline;
  }
  .kinds .num.bad {
    color: var(--known);
  }
  .more {
    margin: 0;
    padding-left: 1.2em;
    display: grid;
    gap: 8px;
    max-width: 70ch;
  }
  .more a {
    font-weight: 600;
  }
  .small {
    font-size: 14px;
    margin-top: 24px;
  }
</style>
