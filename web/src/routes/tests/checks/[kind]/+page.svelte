<script lang="ts">
  import { kindBySlug } from "#lib/tests/kinds.ts";
  import { plain } from "#lib/tests/names.ts";
  import QuestionCard from "#lib/tests/QuestionCard.svelte";
  import Verdict from "#lib/tests/Verdict.svelte";
  import type { ScoredCheck } from "#lib/tests/types.ts";

  const { data } = $props();
  const info = $derived(kindBySlug(data.slug)!);
  const ok = $derived(data.checks.filter((c) => c.ok).length);
  // Failures first, then by page.
  const byPage = $derived.by(() => {
    const groups = new Map<string, ScoredCheck[]>();
    for (const c of data.checks) groups.set(c.page, [...(groups.get(c.page) ?? []), c]);
    return [...groups].sort(([, a], [, b]) => Number(a.every((c) => c.ok)) - Number(b.every((c) => c.ok)));
  });
  const where = (c: ScoredCheck) => c.column ?? (c.table === null ? "page" : `table ${c.table}`);
</script>

<svelte:head>
  <title>{info.title} · Tests · Practical Data</title>
</svelte:head>

<p class="eyebrow-mono">Check · {ok}/{data.checks.length} pass</p>
<h1>{info.title}</h1>
<p class="lede-docs">{info.short}</p>
<p>{info.about}</p>
<p class="rule"><span class="label">Decision rule</span>{data.rule}</p>

{#if data.samples.length > 0}
  <h2>The question, as sent</h2>
  <p class="muted">Real questions from the test pages, verbatim, with the probabilities Jev returned. Question ids are for code and never reach the model; <code class="code-inline">columns[k]</code> points into the table description sent with them.</p>
  <div class="grid samples">
    {#each data.samples as s (s.id)}
      <div>
        <QuestionCard id={s.id} question={s.question} answer={s.answer} />
        <p class="from">from <a href="/tests/pages/{s.page}">{data.names[s.page] ?? s.page}</a></p>
      </div>
    {/each}
  </div>
{/if}

<h2>Every case</h2>
{#each byPage as [slug, cases] (slug)}
  <section class="page-cases">
    <h3><a href="/tests/pages/{slug}">{data.names[slug] ?? slug}</a> <span class="muted mono">{cases.filter((c) => c.ok).length}/{cases.length}</span></h3>
    <div class="scroll-x">
      <table class="list cases">
        <colgroup><col class="c-verdict"><col class="c-column"><col class="c-table"><col><col></colgroup>
        <thead><tr><th></th><th>Column</th><th>Table</th><th>Expected</th><th>Judged</th></tr></thead>
        <tbody>
          {#each cases as c, i (i)}
            <tr class:failed={!c.ok}>
              <td><Verdict ok={c.ok} known={c.known} /></td>
              <td>{where(c)}</td>
              <td class="mono muted">{c.table ?? "—"}</td>
              <td>{plain(c.expected)}</td>
              <td>{plain(c.actual)}</td>
            </tr>
            {#if !c.ok}
              <tr class="detail"><td></td><td colspan="4"><code class="code-inline">{c.message}</code>{#if c.known}<p class="why">{c.known}</p>{/if}</td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/each}

<style>
  .samples { grid-template-columns: minmax(0, 1fr); }
  .from { margin: 6px 0 0; font-size: 13px; color: var(--faint); }
  .page-cases { margin-top: 28px; }
  .page-cases h3 { margin-bottom: 8px; }
  .page-cases h3 a { color: var(--ink); text-decoration: none; }
  .page-cases h3 a:hover { text-decoration: underline; }
  .cases { table-layout: fixed; min-width: 640px; }
  .cases .c-verdict { width: 140px; }
  .cases .c-column { width: 26%; }
  .cases .c-table { width: 64px; }
  .cases td { overflow-wrap: anywhere; }
  tr.failed td { background: var(--known-bg); }
  tr.detail td { padding-top: 0; }
  .why { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
</style>
