<!-- A table's requests and answers, fetched from the page's requests JSON when first opened. -->
<script lang="ts" module>
  import type { PageRequests } from "./types.ts";

  // One fetch per page, shared by all its tables.
  const cache = new Map<string, Promise<PageRequests>>();
  const load = (slug: string) => {
    let p = cache.get(slug);
    if (p === undefined) {
      p = fetch(`/tests/requests/${slug}.json`).then((r) =>
        r.ok ? (r.json() as Promise<PageRequests>) : Promise.reject(new Error(String(r.status))),
      );
      // A failure isn't kept: closing and reopening the panel tries again.
      p.catch(() => cache.delete(slug));
      cache.set(slug, p);
    }
    return p;
  };
</script>

<script lang="ts">
  import { glossaryFor } from "./glossary.ts";
  import Lazy from "./Lazy.svelte";
  import Question from "./Question.svelte";
  import Value from "./Value.svelte";

  interface Props {
    readonly slug: string;
    readonly table: string;
    readonly count: number;
    readonly questions: number;
  }
  const { slug, table, count, questions }: Props = $props();

  /** What a request asks, by question kind, in order: "What kind of numbers are in the column? · Is this row a total?". */
  const topics = (ids: readonly string[]) => [...new Set(ids.map((id) => glossaryFor(id)?.question ?? id))];
</script>

<Lazy
  summary="{questions} {questions === 1 ? 'question' : 'questions'} in {count} {count === 1
    ? 'request'
    : 'requests'} for this table"
>
  <p class="explain">
    The extension groups its questions into requests: one call to the model can carry many questions. The model answers
    each question separately. A request can depend on an earlier answer: for example, the order of labels is asked only
    after the model says the labels are ordered.
  </p>
  {#await load(slug)}
    <p class="muted">Loading the requests.</p>
  {:then requests}
    {#each requests[table] ?? [] as x, xi (xi)}
      <section class="exchange">
        <h4>
          Request {xi + 1}: {Object.keys(x.questions).length}
          {Object.keys(x.questions).length === 1 ? "question" : "questions"}
          <span class="muted">{x.inputTokens.toLocaleString("en-US")} input tokens</span>
        </h4>
        <ul class="topics">
          {#each topics(Object.keys(x.questions)) as q (q)}<li>{q}</li>{/each}
        </ul>
        <details class="state">
          <summary>Table description</summary>
          <Value value={x.state} />
        </details>
        {#each Object.entries(x.questions) as [id, q] (id)}
          <Question {id} question={q} answer={x.answers[id]} />
        {/each}
      </section>
    {/each}
  {:catch e}
    <p class="muted">The requests did not load ({e.message}). Close and open this panel to try again.</p>
  {/await}
</Lazy>

<style>
  .exchange {
    display: grid;
    gap: 28px;
    margin: 20px 0 36px;
  }
  h4 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }
  h4 .muted {
    font-weight: 400;
    margin-left: 8px;
    font-size: 14px;
  }
  .explain {
    margin: 4px 0 0;
    max-width: 70ch;
    font-size: 14.5px;
    color: var(--muted);
  }
  .topics {
    margin: -20px 0 0;
    padding-left: 1.2em;
    font-size: 14px;
    color: var(--muted);
  }
  .state summary {
    cursor: pointer;
    width: fit-content;
    font-size: 14px;
    color: var(--muted);
  }
  .state[open] summary {
    margin-bottom: 8px;
  }
</style>
