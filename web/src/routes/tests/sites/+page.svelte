<script lang="ts">
  import { SITE_NOTES } from "#lib/tests/limitations.ts";

  const { data } = $props();
</script>

<svelte:head>
  <title>Sites to test against · Tests · Practical Data</title>
</svelte:head>

<h1>Sites to test against</h1>
<p class="lede-docs">The checks use copies of the tables on these public pages. Open the pages with the extension to see it on the real site.</p>
<p class="muted">We copied the pages in October 2026. The live pages can change after that date.</p>

<ul class="sites">
  {#each data.sites as s (s.url)}
    <li>
      <a class="name" href={s.url} rel="noopener">{s.title}</a>
      <span class="host">{s.host}</span>
      <p class="checks">Checks: {#each s.kinds as k, i (k.slug)}{i > 0 ? ", " : ""}<a href="/tests/checks/{k.slug}">{k.title.toLowerCase()}</a>{/each}</p>
      {#if SITE_NOTES[s.slug]}<p class="note">{SITE_NOTES[s.slug]} <a href="/tests/limitations">Known limitations</a></p>{/if}
      {#if s.rights}<p class="rights">{s.rights}</p>{/if}
    </li>
  {/each}
</ul>

<style>
  .sites { list-style: none; margin: 32px 0 0; padding: 0; display: grid; gap: 0; max-width: 76ch; }
  .sites li { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .name { font-weight: 650; font-size: 16.5px; }
  .host { margin-left: 8px; font-size: 13.5px; color: var(--faint); }
  .checks { margin: 4px 0 0; font-size: 14.5px; color: var(--muted); }
  .checks a { color: inherit; }
  .note { margin: 6px 0 0; font-size: 14px; color: var(--known); }
  .note a { color: inherit; font-weight: 600; }
  .rights { margin: 2px 0 0; font-size: 13px; color: var(--faint); }
</style>
