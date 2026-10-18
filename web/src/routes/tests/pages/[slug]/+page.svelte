<script lang="ts">
  import { DEFAULT_PALETTE } from "../../../../../../src/core/palettes.ts";
  import { groupSizes } from "#lib/demo.ts";
  import { shade } from "#lib/shade.ts";
  import ColumnCard from "#lib/tests/ColumnCard.svelte";
  import Requests from "#lib/tests/Requests.svelte";
  import QuestionCard from "#lib/tests/QuestionCard.svelte";
  import { plain } from "#lib/tests/names.ts";
  import Verdict from "#lib/tests/Verdict.svelte";
  import type { TableJudgment } from "../../../../../../src/core/types.ts";
  import type { TraceTable } from "#lib/tests/types.ts";

  const { data } = $props();
  const p = $derived(data.page);
  // Only tables the judge saw are traced, so every one has a judgment.
  const judged = $derived(p.tables.map((t) => ({ ...t, judgment: p.judgment.tables.find((j) => j.id === t.snapshot.id)! })));
  const groups = $derived(groupSizes(p.judgment));

  /** Columns in table order: encoded and skipped alike, indexed like the judgment (transposed tables included). */
  type Judged = TraceTable & { readonly judgment: TableJudgment };
  const columnsOf = (t: Judged) =>
    [
      ...t.judgment.encodings.map((e) => ({ col: e.col, header: e.header })),
      ...t.judgment.skipped.map((s) => ({ col: s.col, header: s.header })),
    ].sort((a, b) => a.col - b.col);
  /** Columns code ruled out before asking the model: text, single values, too many distinct values. */
  const ruledOut = (t: Judged) => t.judgment.skipped.filter((sk) => sk.comparable === null);
  const judgedColumns = (t: Judged) => columnsOf(t).filter((c) => !ruledOut(t).some((sk) => sk.col === c.col));
  const checksFor = (t: Judged, header: string) => p.checks.filter((c) => c.table === t.snapshot.id && c.column === header);
  const tableChecks = (t: Judged) => p.checks.filter((c) => c.table === t.snapshot.id && c.column === null);
</script>

<svelte:head>
  <title>{p.name} · Tests · Practical Data</title>
</svelte:head>

<p class="eyebrow-mono">Test page · {p.origin}</p>
<h1>{p.name}</h1>
{#if p.source}
  <p class="source">From <a href={p.source.url} rel="noopener">{p.source.title}</a>{p.source.rights ? ` · ${p.source.rights}` : ""}</p>
{/if}
{#if p.notes}<p class="lede-docs">{p.notes}</p>{/if}

<dl class="stats">
  <div><dt>{p.tables.length}</dt><dd>tables</dd></div>
  <div><dt>{p.columns}</dt><dd>columns shaded</dd></div>
  <div><dt>{p.score[0]}/{p.score[1]}</dt><dd>checks pass</dd></div>
  <div><dt>{p.requests}</dt><dd>requests · {p.inputTokens.toLocaleString("en-US")} tokens</dd></div>
</dl>

{#each judged as t (t.snapshot.id)}
  {@const rows = t.judgment.orientation === "rows"}
  <section class="trace" id={t.snapshot.id}>
    <h2>
      <span class="mono tid">{t.snapshot.id}</span>
      {t.snapshot.title ?? "Untitled table"}
    </h2>
    <p class="meta muted">
      {t.snapshot.headers.length} columns × {t.snapshot.rows.length} rows
      {#if t.judgment.rowsScore !== null}· P(compared across rows) {Math.round(t.judgment.rowsScore * 100)}%{/if}
      {#if rows}· <strong>judged transposed</strong>: each row is one measure{/if}
      {#each tableChecks(t) as c, i (i)} · {c.kind} <Verdict ok={c.ok} known={c.known} />{/each}
    </p>

    <div class="table-frame">
      <table use:shade={{ id: `${p.slug}-${t.snapshot.id}`, judgment: t.judgment, palette: DEFAULT_PALETTE, groupSizes: groups }}>
        <thead><tr>{#each t.snapshot.headers as h, hi (hi)}<th scope="col">{h}</th>{/each}</tr></thead>
        <tbody>
          {#each t.snapshot.rows as row, ri (ri)}<tr>{#each row as cell, ci (ci)}<td>{cell}</td>{/each}</tr>{/each}
        </tbody>
      </table>
    </div>

    {#if t.judgment.aggregateRows.length > 0}
      <p class="muted">Kept out of the scale as totals: {t.judgment.aggregateRows.map((r) => `"${t.snapshot.rows[r]?.[0] ?? r}"`).join(", ")}.</p>
    {/if}

    <div class="columns">
      {#each judgedColumns(t) as c (c.col)}
        <ColumnCard
          header={c.header}
          encoding={t.judgment.encodings.find((e) => e.col === c.col)}
          skipped={t.judgment.skipped.find((s) => s.col === c.col)}
          profile={rows ? undefined : t.profiles.find((pr) => pr.col === c.col)}
          expected={t.expected?.[c.header]}
          checks={checksFor(t, c.header)}
          policy={data.policy}
        />
      {/each}
    </div>

    {#if ruledOut(t).length > 0}
      <div class="ruled">
        <p class="eyebrow-mono">Not sent to the model</p>
        <ul>
          {#each ruledOut(t) as sk (sk.col)}
            <li>
              <span class="h">{sk.header || "(blank)"}</span>
              <span class="muted">{sk.reason}</span>
              {#each checksFor(t, sk.header) as c, i (i)}<Verdict ok={c.ok} known={c.known} label="shade" />{/each}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if t.requests.count > 0}
      <Requests slug={p.slug} table={t.snapshot.id} summary="{t.requests.count} requests · {t.requests.questions} questions · {t.requests.inputTokens.toLocaleString('en-US')} input tokens" />
    {/if}
  </section>
{/each}

{#if p.shared.length > 0}
  <section class="trace">
    <h2>Across tables</h2>
    <p class="muted">One page-level request asks whether same-named columns in different tables measure the same thing, so they can share a scale.</p>
    {#each p.shared as x, xi (xi)}
      <div class="qs">
        {#each Object.entries(x.questions) as [id, q] (id)}
          <QuestionCard {id} question={q} answer={x.answers[id]} />
        {/each}
      </div>
    {/each}
  </section>
{/if}

<h2>All checks on this page</h2>
<div class="scroll-x">
  <table class="list">
    <thead><tr><th></th><th>Check</th><th>Table</th><th>Column</th><th>Expected</th><th>Judged</th></tr></thead>
    <tbody>
      {#each p.checks as c, i (i)}
        <tr>
          <td><Verdict ok={c.ok} known={c.known} /></td>
          <td class="mono">{c.kind}</td>
          <td class="mono muted">{c.table ?? "—"}</td>
          <td>{c.column ?? "—"}</td>
          <td>{plain(c.expected)}</td>
          <td>{plain(c.actual)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .source { margin: 12px 0 0; color: var(--muted); font-size: 15px; }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 28px 0 0; }
  .stats div { border-top: 2px solid var(--ink); padding-top: 10px; }
  .stats dt { font: 500 24px var(--mono); letter-spacing: -0.02em; }
  .stats dd { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
  .trace { margin-top: 56px; }
  .trace h2 { margin: 0; display: flex; align-items: baseline; gap: 12px; }
  .tid { font-size: 14px; color: var(--faint); font-weight: 500; }
  .meta { margin: 6px 0 14px; font-size: 14px; }
  .table-frame { max-height: 480px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); -webkit-overflow-scrolling: touch; }
  .table-frame table { border-collapse: collapse; min-width: 100%; font: 13px/1.4 var(--mono); font-variant-numeric: tabular-nums; }
  .table-frame th { position: sticky; top: 0; z-index: 1; background: var(--paper); text-align: left; font: 600 12px "Bricolage Grotesque", sans-serif; color: var(--muted); }
  .table-frame th, .table-frame td { padding: 6px 10px; white-space: nowrap; border-bottom: 1px solid var(--line); }
  .columns { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); align-items: start; gap: 12px; margin: 16px 0; }
  .ruled { margin: 0 0 16px; }
  .ruled ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; }
  .ruled li { display: inline-flex; align-items: baseline; gap: 8px; }
  .ruled .h { font-weight: 600; }
  .qs { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 10px; }
  @media (max-width: 640px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
