<script lang="ts">
  import CaseTable from "#lib/tests/CaseTable.svelte";
  import { kindBySlug } from "#lib/tests/kinds.ts";
  import Question from "#lib/tests/Question.svelte";

  const { data } = $props();
  const info = $derived(kindBySlug(data.slug)!);
  const failing = $derived(data.total - data.passed);
  const tableTitle = (slug: string, id: string | null) => data.cases.find((c) => c.slug === slug && c.id === id)?.title;
</script>

<svelte:head>
  <title>{info.title} · Tests · Practical Data</title>
  <meta name="description" content="{info.short} {data.passed} of {data.total} checks pass.">
</svelte:head>

<h1>{info.title}</h1>
<p class="lede-docs">{info.short}</p>
{#each info.about as para, i (i)}<p>{para}</p>{/each}

<dl class="rule">
  <dt>Decision rule</dt>
  <dd>{data.rule}</dd>
</dl>

{#if data.samples.length > 0}
  <h2>{data.samples.length === 1 ? "The question" : "The questions"}</h2>
  <p class="muted">
    The model gets the question text and a short description of the table. It gives a probability for each possible answer.
    {data.samples.length === 1 ? "This is a real question" : "These are real questions"} from the test pages, with the recorded answers.
  </p>
  {#each data.samples as s (s.id)}
    {@const title = tableTitle(s.page, s.table)}
    <div class="sample">
      <Question id={s.id} question={s.question} answer={s.answer} state={s.state} />
      {#if title}<p class="from">Asked about <a href="#{s.page}-{s.table}">{title}</a>.</p>{/if}
    </div>
  {/each}
{/if}

<h2>Results</h2>
<p class="summary">
  <strong>{data.passed} of {data.total}</strong> checks pass, on {data.cases.length} {data.cases.length === 1 ? "table" : "tables"}.
  {#if failing > 0}{failing === data.known ? `The ${failing === 1 ? "failure is a known issue" : `${failing} failures are known issues`}.` : `${failing - data.known} ${failing - data.known === 1 ? "failure is" : "failures are"} not known issues.`} Tables with a failure come first.{/if}
</p>
<p class="muted">Each table shows the shading that the extension applies. Put the pointer on a result to outline its column. A red outline shows a failure.</p>

{#each data.cases as t (`${t.slug}:${t.id}`)}
  <CaseTable {t} />
{/each}

<style>
  .rule { margin: 24px 0 0; max-width: 70ch; padding: 14px 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
  .rule dt { font-size: 13px; font-weight: 600; color: var(--faint); }
  .rule dd { margin: 4px 0 0; font-size: 15.5px; }
  .sample { margin: 28px 0 0; padding-bottom: 28px; border-bottom: 1px solid var(--line); }
  .sample:last-of-type { border-bottom: 0; }
  .from { margin: 6px 0 0; font-size: 14px; color: var(--muted); }
  .summary { font-size: 17px; }
</style>
