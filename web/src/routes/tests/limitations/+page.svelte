<script lang="ts">
  const { data } = $props();
</script>

<svelte:head>
  <title>Known limitations · Tests · Practical Data</title>
</svelte:head>

<h1>Known limitations</h1>
<p class="lede-docs">These are mistakes that the tool makes on real tables. Each one causes a check to fail. CI accepts these failures, but no other failures.</p>

{#each data.limitations as l, i (i)}
  <section class="limit">
    <h2>{l.title}</h2>
    {#if l.body}<p>{l.body}</p>{/if}
    <p class="seen">
      Example{l.examples.length === 1 ? "" : "s"}:
      {#each l.examples as e, j (j)}{j > 0 ? "; " : ""}<a href="/tests/checks/{e.slug}#{e.anchor}">{e.column ?? "whole table"}</a> in {e.page} ({e.kind.toLowerCase()}){/each}.
    </p>
  </section>
{:else}
  <p>No check fails at this time.</p>
{/each}

<style>
  .limit { margin-top: 48px; max-width: 70ch; }
  .limit h2 { margin: 0 0 8px; font-size: 22px; }
  .limit p { margin: 0 0 8px; }
  .seen { font-size: 14.5px; color: var(--muted); }
</style>
