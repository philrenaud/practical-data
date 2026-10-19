<script lang="ts">
  import { answerAnchor, answerName, GLOSSARY } from "#lib/tests/glossary.ts";
</script>

<svelte:head>
  <title>Glossary · Tests · Practical Data</title>
</svelte:head>

<h1>Glossary</h1>
<p class="lede-docs">Each question that the extension asks, and what each answer means. The model gives a probability for each answer.</p>
<p class="muted">The text sent to the model has more examples. It is in <code>src/decide/questions.ts</code>.</p>

{#each GLOSSARY as g (g.kinds[0])}
  <section class="entry">
    <h2>{g.question}</h2>
    <dl>
      {#each Object.entries(g.answers) as [key, text] (key)}
        <div id={answerAnchor(g, key)}><dt>{answerName(key)}</dt><dd>{text}</dd></div>
      {/each}
    </dl>
  </section>
{/each}

<style>
  .entry { margin-top: 44px; max-width: 72ch; }
  .entry h2 { margin: 0 0 12px; font-size: 21px; }
  dl { margin: 0; display: grid; gap: 0; }
  dl div { display: grid; grid-template-columns: 11em minmax(0, 1fr); gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--line); scroll-margin-top: 24px; }
  dl div:last-child { border-bottom: 0; }
  dl div:target { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  dt { font-weight: 600; }
  dd { margin: 0; color: var(--muted); }
  @media (max-width: 560px) { dl div { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
</style>
