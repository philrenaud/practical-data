<script lang="ts">
  import { KINDS } from "#lib/tests/kinds.ts";

  const { data } = $props();
  const failing = $derived(data.checkCount - data.passCount);
  const knownFailing = $derived(Object.values(data.totals).reduce((n, t) => n + t.known, 0));
  const live = $derived(data.pages.filter((p) => p.source !== null));
  const synthetic = $derived(data.pages.length - live.length);
</script>

<svelte:head>
  <title>Tests · Practical Data</title>
  <meta name="description" content="How Practical Data tests its decisions: hand-labeled tables, recorded model answers, and checks that anyone can run again offline.">
</svelte:head>

<h1>How we test the decisions</h1>
<p class="lede-docs">
  The extension asks a decision model short questions about each table. The answers tell the extension which columns to shade and which direction is better.
</p>
<p>
  We gave hand labels to the columns of {data.pages.length} test pages. Each check compares one decision with its hand label.
  The checks use recorded answers, thus you can run them again without a model key.
</p>

<p class="score">
  <strong>{data.passCount} of {data.checkCount}</strong> checks pass.
  {#if failing > 0}{failing === knownFailing ? `${failing === 1 ? "The failure is a known issue" : "All failures are known issues"}. Any other failure stops the build.` : `${failing - knownFailing} ${failing - knownFailing === 1 ? "failure is" : "failures are"} not known issues.`}{/if}
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

<h2>How a check runs</h2>
<ol class="run">
  <li>
    <strong>Read the page.</strong> The extension's extractor reads each test page. It keeps only the tables, as text.
    <code>fixtures/snapshots/</code>
  </li>
  <li>
    <strong>Judge.</strong> The judge asks the same questions as the extension. Recorded answers replace the model. A changed question has no recording, and the run fails.
    <code>fixtures/recordings/</code>
  </li>
  <li>
    <strong>Compare.</strong> Code compares each decision with its hand label. Columns without a hand label get no score.
    <code>fixtures/expectations.json</code>
  </li>
  <li>
    <strong>Stop on failure.</strong> CI runs the checks on each change. A failure that is not a known issue stops the build, and the site does not deploy.
  </li>
</ol>
<pre class="code">$ npm run eval -- --offline --strict     # the {data.checkCount} checks on this site
$ npm test                                # unit tests
$ npm run e2e -- --offline                # each test page in a real browser, with the extension</pre>

{#if data.known.length > 0}
  <h2>Known issues</h2>
  <ul class="known">
    {#each data.known as k, i (i)}
      <li>
        <a href="/tests/checks/{k.check.slug}#{k.anchor}">{k.check.title}: {k.column ?? "whole table"}</a> <span class="muted">· {k.page}</span>
        <p>{k.why}</p>
      </li>
    {/each}
  </ul>
{/if}

<h2>Sources</h2>
<p class="muted">
  {live.length} test pages are copies of public pages, with the tables only. {synthetic} test pages are synthetic: we made them to test difficult cases.
  {data.requests} recorded requests ({data.inputTokens.toLocaleString("en-US")} input tokens) answer all the questions.
</p>
<div class="scroll-x">
  <table class="list">
    <thead><tr><th scope="col">Page</th><th scope="col">Rights</th></tr></thead>
    <tbody>
      {#each live as p (p.slug)}
        <tr>
          <th scope="row"><a href={p.source?.url} rel="noopener">{p.source?.title}</a></th>
          <td class="muted">{p.source?.rights}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .score { margin: 28px 0 0; font-size: 18px; }
  .kinds th[scope="row"] a { color: var(--ink); font-weight: 600; text-decoration: none; }
  .kinds th[scope="row"] a:hover { text-decoration: underline; }
  .kinds .num.bad { color: var(--known); }
  .run { margin: 0 0 20px; padding-left: 1.4em; display: grid; gap: 12px; max-width: 70ch; }
  .run li { padding-left: 4px; }
  .run code { display: block; margin-top: 2px; font: 13px var(--mono); color: var(--muted); }
  .known { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; max-width: 70ch; }
  .known p { margin: 4px 0 0; }
</style>
