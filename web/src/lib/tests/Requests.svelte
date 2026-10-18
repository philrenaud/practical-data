<!-- A table's raw requests and answers, fetched from the page's requests.json when first opened. -->
<script lang="ts" module>
  import type { PageRequests } from "./types.ts";

  // One fetch per page, shared by all its tables.
  const cache = new Map<string, Promise<PageRequests>>();
  const load = (slug: string) => {
    let p = cache.get(slug);
    if (p === undefined) {
      p = fetch(`/tests/pages/${slug}/requests.json`).then((r) => (r.ok ? (r.json() as Promise<PageRequests>) : Promise.reject(new Error(String(r.status)))));
      // A failure isn't kept: closing and reopening the panel tries again.
      p.catch(() => cache.delete(slug));
      cache.set(slug, p);
    }
    return p;
  };
</script>

<script lang="ts">
  import Lazy from "./Lazy.svelte";
  import QuestionCard from "./QuestionCard.svelte";
  interface Props {
    readonly slug: string;
    readonly table: string;
    readonly summary: string;
  }
  const { slug, table, summary }: Props = $props();

</script>

<Lazy {summary}>
  {#await load(slug)}
    <p class="muted">Loading requests…</p>
  {:then requests}
    {#each requests[table] ?? [] as x, xi (xi)}
      <div class="exchange">
        <p class="eyebrow-mono">Request {xi + 1} · {Object.keys(x.questions).length} questions · {x.inputTokens.toLocaleString("en-US")} tokens</p>
        <Lazy summary="State sent with it">
          <pre class="code">{JSON.stringify(x.state, null, 2)}</pre>
        </Lazy>
        <div class="qs">
          {#each Object.entries(x.questions) as [id, q] (id)}
            <QuestionCard {id} question={q} answer={x.answers[id]} />
          {/each}
        </div>
      </div>
    {/each}
  {:catch e}
    <p class="muted">Couldn't load the requests ({e.message}).</p>
  {/await}
</Lazy>

<style>
  .exchange { margin: 18px 0 28px; }
  .qs { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 10px; }
</style>
