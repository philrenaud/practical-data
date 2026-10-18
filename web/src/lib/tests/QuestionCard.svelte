<!-- One question exactly as sent to the model, and its answer when there is one. -->
<script lang="ts">
  import type { Answer, Prose, Question } from "../../../../src/decide/model.ts";
  import Prob from "./Prob.svelte";

  interface Props {
    readonly id: string;
    readonly question: Question;
    readonly answer?: Answer | undefined;
  }
  const { id, question, answer }: Props = $props();

  const text = (p: Prose | null | undefined): string =>
    p === null || p === undefined ? "" : typeof p === "string" ? p : JSON.stringify(p, null, 2);
  const probs = $derived(answer !== undefined && answer.type !== "noul" ? answer.probabilities : {});
  const options = $derived(
    question.type === "choice"
      ? Object.entries(question.criteria).map(([key, prose]) => ({ key, prose: text(prose) }))
      : question.type === "score"
        ? question.criteria.map((prose, i) => ({ key: String(i), prose: text(prose) }))
        : [],
  );
  const winner = $derived(answer?.type === "choice" ? answer.choice : null);
</script>

<article class="q">
  <header>
    <code class="qid">{id}</code>
    <span class="qtype">{question.type}</span>
  </header>
  {#if typeof question.instructions === "string"}
    <p class="instructions">{question.instructions}</p>
  {:else}
    <pre class="code">{text(question.instructions)}</pre>
  {/if}
  {#if question.type === "noul"}
    <div class="answers">
      <Prob label="yes" p={answer?.type === "noul" ? answer.noul : null} chosen={answer?.type === "noul" && answer.noul >= 0.5} />
    </div>
  {:else}
    <dl class="options">
      {#each options as o (o.key)}
        <div class="option" class:won={winner === o.key}>
          <dt>
            <Prob label={o.key} p={answer === undefined ? null : (probs[o.key] ?? 0)} chosen={winner === o.key} />
          </dt>
          {#if o.prose !== ""}<dd>{o.prose}</dd>{/if}
        </div>
      {/each}
    </dl>
  {/if}
</article>

<style>
  .q { min-width: 0; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--paper); }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .qid { font: 500 12.5px var(--mono); color: var(--accent); }
  .qtype { font: 11px var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  .instructions { margin: 0 0 10px; font-size: 15px; }
  .options { margin: 0; display: grid; gap: 6px; }
  .option dd { margin: 0 0 4px; padding-left: calc(min(30%, 9999px) + 10px); font-size: 13px; color: var(--faint); line-height: 1.45; }
  .option.won dd { color: var(--muted); }
  .answers { margin-top: 4px; }
  @media (max-width: 640px) { .option dd { padding-left: 0; } }
</style>
