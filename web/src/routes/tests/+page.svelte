<script lang="ts">
  import { KINDS } from "#lib/tests/kinds.ts";

  const { data } = $props();
  const failing = $derived(data.checkCount - data.passCount);
  const knownFailing = $derived(Object.values(data.totals).reduce((n, t) => n + t.known, 0));
</script>

<svelte:head>
  <title>Tests · Practical Data</title>
  <meta name="description" content="Every column Practical Data judges on its test pages, checked against a hand label, with the questions the model was asked and the answers it gave.">
</svelte:head>

<p class="eyebrow-mono">Test suite</p>
<h1>Every judgment, checked against a hand label.</h1>
<p class="lede-docs">
  The extension decides which columns to shade, and which way is better, by asking a decision model narrow questions.
  This is what it is held to: {data.checkCount} hand-labeled checks across {data.pages.length} real and synthetic pages,
  replayed from recorded answers so anyone can rerun them offline, plus the unit tests under the parsing and painting.
</p>

<div class="score">
  <span class="big">{data.passCount}<span class="of">/{data.checkCount}</span></span>
  <span class="muted">checks pass.{failing === 0 ? "" : failing === knownFailing ? ` ${failing === 1 ? "The failure is" : "All failures are"} documented below, and the CI gate fails on any other.` : ` ${failing - knownFailing} undocumented ${failing - knownFailing === 1 ? "failure" : "failures"}.`}</span>
</div>

<h2>Checks</h2>
<div class="grid kinds">
  {#each KINDS as k (k.kind)}
    {@const t = data.totals[k.kind]}
    <a class="card kind" href="/tests/checks/{k.slug}">
      <span class="ratio" class:bad={t.ok < t.total}>{t.ok}<span class="of">/{t.total}</span></span>
      <h3>{k.title}</h3>
      <p class="muted">{k.short}</p>
      <span class="meter" aria-hidden="true"><span style:width="{(100 * t.ok) / Math.max(1, t.total)}%"></span></span>
    </a>
  {/each}
</div>

<h2>How a check runs</h2>
<ol class="pipeline">
  <li>
    <span class="step">01</span>
    <h3>Snapshot</h3>
    <p>Each test page is reduced to its tables by the extension's own extractor: merged cells resolved, header rows found, text only. <code class="code-inline">fixtures/snapshots/</code></p>
  </li>
  <li>
    <span class="step">02</span>
    <h3>Judge</h3>
    <p>The same judge the extension runs asks its questions, but answers come from recordings keyed by a hash of each request. A changed question is a new key, and an unrecorded one fails the run. <code class="code-inline">fixtures/recordings/</code></p>
  </li>
  <li>
    <span class="step">03</span>
    <h3>Score</h3>
    <p>The judgment is compared with hand labels: shade or not, direction, scale, label order, totals, shared scales, orientation. Columns nobody hand-labeled are judged but not scored. <code class="code-inline">fixtures/expectations.json</code></p>
  </li>
  <li>
    <span class="step">04</span>
    <h3>Gate</h3>
    <p>CI runs the eval with <code class="code-inline">--offline --strict</code>: any mismatch not documented as a known failure fails the build, and the site doesn't deploy.</p>
  </li>
</ol>
<pre class="code">$ npm run eval -- --offline --strict     # the {data.checkCount} checks on this site
$ npm test                                # unit tests
$ npm run e2e -- --offline                # every test page in a real browser, with the extension loaded</pre>

{#if Object.keys(data.known).length > 0}
  <h2>Known failures</h2>
  <ul class="known">
    {#each Object.entries(data.known) as [key, why] (key)}
      <li class="card"><code class="code-inline">{key}</code><p>{why}</p></li>
    {/each}
  </ul>
{/if}

<h2>Test pages</h2>
<p class="muted">Excerpts of public pages (tables only, with attribution) and synthetic pages written to break things. Each links to a full trace.</p>
<div class="scroll-x">
  <table class="list">
    <thead>
      <tr><th>Page</th><th>Source</th><th class="num">Tables</th><th class="num">Shaded</th><th class="num">Checks</th><th class="num">Requests</th></tr>
    </thead>
    <tbody>
      {#each data.pages as p (p.slug)}
        <tr>
          <td><a href="/tests/pages/{p.slug}">{p.name}</a></td>
          <td class="muted">{p.origin === "live" ? new URL(p.source?.url ?? "https://x").hostname.replace(/^www\./, "") : "synthetic"}</td>
          <td class="num">{p.tables}</td>
          <td class="num">{p.columns}</td>
          <td class="num">{p.score[0]}/{p.score[1]}</td>
          <td class="num">{p.requests}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<p class="muted small">{data.requests} requests and {data.inputTokens.toLocaleString("en-US")} input tokens in all, replayed in seconds at no cost.</p>

<style>
  .score { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin: 28px 0 0; }
  .big { font: 500 44px/1 var(--mono); letter-spacing: -0.03em; }
  .of { color: var(--faint); }
  .kinds { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  @media (max-width: 1100px) { .kinds { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .kinds { grid-template-columns: minmax(0, 1fr); } }
  .kinds .kind { display: grid; gap: 4px; text-decoration: none; color: inherit; transition: border-color 120ms, transform 120ms; }
  .kinds .kind:hover { border-color: var(--accent); }
  .kinds .kind:active { transform: translateY(1px); }
  .kind p { margin: 0; font-size: 14px; }
  .ratio { font: 500 26px/1.1 var(--mono); letter-spacing: -0.02em; }
  .ratio.bad { color: var(--known); }
  .meter { margin-top: 10px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--line) 80%, transparent); overflow: hidden; }
  .meter span { display: block; height: 100%; background: var(--pass); }
  .pipeline { list-style: none; margin: 0 0 16px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .pipeline li { border-top: 2px solid var(--ink); padding-top: 12px; }
  .pipeline p { margin: 6px 0 0; font-size: 14.5px; color: var(--muted); }
  .step { font: 500 12.5px var(--mono); color: var(--faint); }
  .known { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .known p { margin: 6px 0 0; color: var(--muted); }
  .small { font-size: 14px; }
  @media (max-width: 900px) { .pipeline { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .pipeline { grid-template-columns: minmax(0, 1fr); } }
</style>
