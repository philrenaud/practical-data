<script lang="ts">
  import { SITE_LIMITATIONS } from "#lib/tests/limitations.ts";

  const { data } = $props();
</script>

<svelte:head>
  <title>Known limitations · Tests · Practical Data</title>
</svelte:head>

<h1>Known limitations</h1>
<p class="lede-docs">These are mistakes that the tool makes on real pages.</p>
<p>The first ones cause a check to fail. CI accepts these failures, but no other failures. The last ones show only on live pages.</p>

{#each data.limitations as l, i (i)}
  <section class="limit">
    <h2>{l.title}</h2>
    {#if l.body}<p>{l.body}</p>{/if}
    <p class="seen">
      Example{l.examples.length === 1 ? "" : "s"}:
      {#each l.examples as e, j (j)}{j > 0 ? "; " : ""}<a href="/tests/checks/{e.slug}#{e.anchor}">{e.column ?? "whole table"}</a> in {e.page} ({e.kind.toLowerCase()}){/each}.
    </p>
  </section>
{/each}

{#each SITE_LIMITATIONS as l (l.title)}
  <section class="limit">
    <h2>{l.title}</h2>
    <p>{l.body}</p>
    <p class="seen">Example{l.examples.length === 1 ? "" : "s"}: {#each l.examples as e, j (e.url)}{j > 0 ? "; " : ""}<a href={e.url} rel="noopener">{e.label}</a>{/each}.</p>
  </section>
{/each}

<style>
  .limit { margin-top: 48px; max-width: 70ch; }
  .limit h2 { margin: 0 0 8px; font-size: 22px; }
  .limit p { margin: 0 0 8px; }
  .seen { font-size: 14.5px; color: var(--muted); }
</style>
