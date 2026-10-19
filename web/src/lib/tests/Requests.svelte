<!-- A table's requests and answers, fetched from the page's requests JSON when first opened. -->
<script lang="ts" module>
  import type { PageRequests } from "./types.ts";

  // One fetch per page, shared by all its tables.
  const cache = new Map<string, Promise<PageRequests>>();
  const load = (slug: string) => {
    let p = cache.get(slug);
    if (p === undefined) {
      p = fetch(`/tests/requests/${slug}.json`).then((r) => (r.ok ? (r.json() as Promise<PageRequests>) : Promise.reject(new Error(String(r.status)))));
      // A failure isn't kept: closing and reopening the panel tries again.
      p.catch(() => cache.delete(slug));
      cache.set(slug, p);
    }
    return p;
  };
</script>

<script lang="ts">
  import Lazy from "./Lazy.svelte";
  import Question from "./Question.svelte";
  import Value from "./Value.svelte";

  interface Props {
    readonly slug: string;
    readonly table: string;
    readonly count: number;
  }
  const { slug, table, count }: Props = $props();
</script>

<Lazy summary="All {count} {count === 1 ? 'request' : 'requests'} for this table">
  {#await load(slug)}
    <p class="muted">Loading the requests.</p>
  {:then requests}
    {#each requests[table] ?? [] as x, xi (xi)}
      <section class="exchange">
        <h4>Request {xi + 1} <span class="muted">{Object.keys(x.questions).length} questions · {x.inputTokens.toLocaleString("en-US")} input tokens</span></h4>
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
  .exchange { display: grid; gap: 28px; margin: 20px 0 36px; }
  h4 { margin: 0; font-size: 15px; font-weight: 650; }
  h4 .muted { font-weight: 400; margin-left: 8px; font-size: 14px; }
  .state summary { cursor: pointer; width: fit-content; font-size: 14px; color: var(--muted); }
  .state[open] summary { margin-bottom: 8px; }
</style>
