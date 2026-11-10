<script lang="ts">
  import { SITE_LIMITATIONS } from "#lib/tests/limitations.ts";

  const { data } = $props();
</script>

<svelte:head>
  <title>Known limitations · Tests · Practical Data</title>
</svelte:head>

<h1>Known limitations</h1>
<p class="lede-docs">
  When I hand-labelled table decisions for eval reasons in October 2025, these are the mistakes that Practical Data made
  that, if I were to fix, would break some other rule.
</p>
<p>
  I guess the best way to explain this section is to say that data on the web is messy in inconsistent ways. The
  failures here are happily sparse and (IMO) don't detract from the overall usefulness of the tool, but they're worth
  noting.
</p>
<p>
  Consider the first one here; a basketball-reference table lists heights using <em>feet-inches</em> format. Practical Data
  has a "identify ranges like 10-20" rule, which feels overall very useful for shading range-based columns, but that means
  that someone's height being listed as 5-10 gets us into trouble.
</p>

{#each data.limitations as l, i (i)}
  <section class="limit">
    <h2>{l.title}</h2>
    {#if l.body}<p>{l.body}</p>{/if}
    <p class="seen">
      Example{l.examples.length === 1 ? "" : "s"}:
      {#each l.examples as e, j (j)}{j > 0 ? "; " : ""}<a href="/tests/checks/{e.slug}#{e.anchor}"
          >{e.column ?? "whole table"}</a
        >
        in {e.page} ({e.kind.toLowerCase()}){/each}.
    </p>
  </section>
{/each}

{#each SITE_LIMITATIONS as l (l.title)}
  <section class="limit">
    <h2>{l.title}</h2>
    <p>{l.body}</p>
    <p class="seen">
      Example{l.examples.length === 1 ? "" : "s"}: {#each l.examples as e, j (e.url)}{j > 0 ? "; " : ""}<a
          href={e.url}
          rel="noopener">{e.label}</a
        >{/each}.
    </p>
  </section>
{/each}

<style>
  .limit {
    margin-top: 48px;
    max-width: 70ch;
  }
  .limit h2 {
    margin: 0 0 8px;
    font-size: 22px;
  }
  .limit p {
    margin: 0 0 8px;
  }
  .seen {
    font-size: 14.5px;
    color: var(--muted);
  }
</style>
