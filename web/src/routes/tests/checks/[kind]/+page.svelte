<script lang="ts">
  import CaseTable from "#lib/tests/CaseTable.svelte";
  import { kindBySlug } from "#lib/tests/kinds.ts";
  import Question from "#lib/tests/Question.svelte";
  import ShareGroup from "#lib/tests/ShareGroup.svelte";
  import TablePreview from "#lib/tests/TablePreview.svelte";

  const { data } = $props();
  const info = $derived(kindBySlug(data.slug)!);
  const failing = $derived(data.total - data.passed);
  const caseOf = (slug: string, id: string | null) => data.cases.find((c) => c.slug === slug && c.id === id);
  /** The column or row a question is about, from its id: "n4.role" is column 4, "row9.aggregate" is row 9. */
  const indexIn = (re: RegExp, id: string) => {
    const n = re.exec(id)?.[1];
    return n === undefined ? null : Number(n);
  };
  const targetOf = (id: string) => ({ col: indexIn(/^[nc](\d+)\./, id), row: indexIn(/^row(\d+)\./, id) });
</script>

<svelte:head>
  <title>{info.title} · Tests · Practical Data</title>
  <meta name="description" content="{info.short} {data.passed} of {data.total} checks pass." />
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
    The model gets the question text and a short description of the table. It gives a probability for each possible
    answer.
    {data.samples.length === 1 ? "This is a real question" : "These are real questions"} from the test pages, with the recorded
    answers. Here, the question names the column by its header. The question that the extension sends points to the column
    in the table description.
  </p>
  {#each data.samples as s (s.id)}
    {@const t = caseOf(s.page, s.table)}
    {@const target = targetOf(s.id)}
    <div class="sample">
      {#if t}<TablePreview {t} col={target.col} row={target.row} />{/if}
      <Question id={s.id} question={s.question} answer={s.answer} state={s.state} />
    </div>
  {/each}
{/if}

<h2>Results</h2>
<p class="summary">
  <strong>{data.passed} of {data.total}</strong> checks pass, on {data.cases.length}
  {data.cases.length === 1 ? "table" : "tables"}.
  {#if failing > 0}{failing === data.known
      ? `The ${failing === 1 ? "failure is a known issue" : `${failing} failures are known issues`}.`
      : `${failing - data.known} ${failing - data.known === 1 ? "failure is" : "failures are"} not known issues.`} Tables
    with a failure come first.{/if}
</p>
<p class="muted">
  Each table shows the shading that the extension applies. The strip under the table shows all judgments on each column.
  Put the pointer on a result to outline its column. A red outline shows a failure.
</p>

{#each data.groups as g, i (i)}
  <ShareGroup {g} />
{/each}

{#each data.cases as t (`${t.slug}:${t.id}`)}
  <CaseTable {t} />
{:else}
  <p class="muted">No real test table has a check of this kind yet.</p>
{/each}

<style>
  .rule {
    margin: 24px 0 0;
    max-width: 70ch;
    padding: 14px 16px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .rule dt {
    font-size: 13px;
    font-weight: 600;
    color: var(--faint);
  }
  .rule dd {
    margin: 4px 0 0;
    font-size: 15.5px;
  }
  .sample {
    margin: 28px 0 0;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--line);
  }
  .sample:last-of-type {
    border-bottom: 0;
  }
  .summary {
    font-size: 17px;
  }
</style>
