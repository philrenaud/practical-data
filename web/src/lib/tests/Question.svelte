<!--
  One question as the model received it: the question text, the context sent
  with it, and each possible answer with the probability the model gave it.
-->
<script lang="ts">
  import type { Answer, Prose, Question } from "../../../../src/decide/model.ts";
  import Value from "./Value.svelte";

  interface Props {
    readonly id: string;
    readonly question: Question;
    readonly answer?: Answer | undefined;
    /** The request's state (the table description), when shown with the question. */
    readonly state?: unknown;
  }
  const { id, question, answer, state }: Props = $props();

  // Structured instructions carry the question in `question` and context in the other fields.
  const instructions = $derived(question.instructions);
  const ask = $derived(
    typeof instructions === "string"
      ? instructions
      : typeof (instructions as Record<string, unknown>)["question"] === "string"
        ? ((instructions as Record<string, unknown>)["question"] as string)
        : null,
  );
  const context = $derived(
    typeof instructions === "string" ? null : Object.fromEntries(Object.entries(instructions as Record<string, unknown>).filter(([k]) => k !== "question")),
  );
  const prose = (p: Prose | null): string => (p === null ? "" : typeof p === "string" ? p : JSON.stringify(p));
  const options = $derived.by(() => {
    if (question.type === "noul") {
      const p = answer?.type === "noul" ? answer.noul : null;
      return [
        { key: "yes", prose: "", p },
        { key: "no", prose: "", p: p === null ? null : 1 - p },
      ];
    }
    const probs = answer !== undefined && answer.type !== "noul" ? answer.probabilities : {};
    const entries = question.type === "choice" ? Object.entries(question.criteria) : question.criteria.map((c, i) => [String(i), c] as const);
    return entries.map(([key, c]) => ({ key, prose: prose(c), p: answer === undefined ? null : (probs[key] ?? 0) }));
  });
  const top = $derived(Math.max(...options.map((o) => o.p ?? 0)));
</script>

<figure class="question">
  {#if ask !== null}
    <!-- Backticks mark paths into the context sent with the question, as the TypeSafe docs recommend. -->
    <blockquote class="ask">{#each ask.split("`") as part, i (i)}{#if i % 2 === 1}<code class="path">{part}</code>{:else}{part}{/if}{/each}</blockquote>
  {/if}
  {#if context !== null && Object.keys(context).length > 0}
    <div class="context"><Value value={context} /></div>
  {/if}
  {#if state !== undefined}
    <details class="state">
      <summary>Table description sent with this question</summary>
      <Value value={state} />
    </details>
  {/if}
  <table class="answers">
    <thead><tr><th scope="col">Answer</th><th scope="col" class="p">Probability</th></tr></thead>
    <tbody>
      {#each options as o (o.key)}
        <tr class:top={o.p !== null && o.p === top}>
          <td>
            <code>{o.key}</code>
            {#if o.prose !== ""}<span class="prose">{o.prose}</span>{/if}
          </td>
          <td class="p">
            <span class="bar" aria-hidden="true"><span style:width="{(o.p ?? 0) * 100}%"></span></span>
            <span class="pct">{o.p === null ? "not asked" : `${Math.round(o.p * 100)}%`}</span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <figcaption><code>{id}</code> · {question.type}</figcaption>
</figure>

<style>
  .question { margin: 0; min-width: 0; }
  .ask { margin: 0 0 12px; font-size: 17px; line-height: 1.5; max-width: 68ch; }
  .path { font: 0.86em var(--mono); padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--ink); }
  .context { margin: 0 0 12px; }
  .state { margin: 0 0 12px; }
  .state summary { cursor: pointer; width: fit-content; font-size: 14px; color: var(--muted); }
  .state[open] summary { margin-bottom: 8px; }
  .answers { width: 100%; border-collapse: collapse; font-size: 14px; }
  .answers th { text-align: left; font-size: 12.5px; font-weight: 600; color: var(--faint); padding: 0 0 6px; border-bottom: 1px solid var(--line); }
  .answers td { padding: 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  .answers td:first-child { padding-right: 20px; }
  .answers code { font: 500 13px var(--mono); color: var(--muted); }
  .answers .top code { color: var(--ink); }
  .prose { display: block; margin-top: 2px; color: var(--faint); line-height: 1.45; max-width: 70ch; }
  .top .prose { color: var(--muted); }
  .p { width: 168px; }
  td.p { white-space: nowrap; }
  .bar { display: inline-block; width: 96px; height: 6px; margin-right: 10px; vertical-align: middle; background: color-mix(in srgb, var(--line) 70%, transparent); border-radius: 3px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: color-mix(in srgb, var(--muted) 60%, transparent); }
  .top .bar span { background: var(--accent); }
  .pct { font: 13px var(--mono); font-variant-numeric: tabular-nums; color: var(--muted); }
  .top .pct { color: var(--ink); }
  figcaption { margin-top: 8px; font-size: 13px; color: var(--faint); }
  figcaption code { font: 12.5px var(--mono); }
  @media (max-width: 560px) { .p { width: 120px; } .bar { width: 52px; } }
</style>
