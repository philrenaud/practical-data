<script lang="ts">
  import { answerAnchor, answerName, DESCRIPTION_FIELDS, GLOSSARY, NOTES, SPREADS } from "#lib/tests/glossary.ts";
</script>

<svelte:head>
  <title>Glossary · Tests · Practical Data</title>
</svelte:head>

<h1>Glossary</h1>
<p class="lede-docs">
  Each question that the extension asks, and what each answer means. The model gives a probability for each answer.
</p>
<p class="muted">The text sent to the model has more examples. It is in <code>src/decide/questions.ts</code>.</p>

<h2 class="part">Answers</h2>
{#each GLOSSARY as g (g.kinds[0])}
  <section class="entry">
    <h2>{g.question}</h2>
    <dl>
      {#each Object.entries(g.answers) as [key, text] (key)}
        <div id={answerAnchor(g, key)}>
          <dt>{answerName(key)}</dt>
          <dd>{text}</dd>
        </div>
      {/each}
    </dl>
  </section>
{/each}

<h2 class="part" id="description">The table description</h2>
<p>
  Each request includes a short description of the table. Practical Data makes it from the cells of the table: the page
  itself does not supply it. The model reads the description, then answers the questions. The description has these
  fields.
</p>
<section class="entry">
  <dl>
    {#each DESCRIPTION_FIELDS as f (f.field)}
      <div>
        <dt><code>{f.field}</code></dt>
        <dd>{f.text}</dd>
      </div>
    {/each}
  </dl>
</section>
<section class="entry" id="spread">
  <h3>Possible values of <code>spread</code></h3>
  <dl>
    {#each SPREADS as v (v.text)}
      <div>
        <dt class="value">{v.text}</dt>
        <dd>{v.when}</dd>
      </div>
    {/each}
  </dl>
</section>
<section class="entry" id="notes">
  <h3>Possible values of <code>notes</code></h3>
  <dl>
    {#each NOTES as v (v.text)}
      <div>
        <dt class="value">{v.text}</dt>
        <dd>{v.when}</dd>
      </div>
    {/each}
  </dl>
</section>

<style>
  .part {
    margin-top: 64px;
    font-size: 26px;
  }
  .entry h3 {
    margin: 0 0 10px;
    font-size: 18px;
  }
  .entry h3 code {
    font: 600 0.92em var(--mono);
  }
  dt code {
    font: 600 13px var(--mono);
  }
  dt.value {
    font: 500 13px/1.45 var(--mono);
  }
  .entry {
    margin-top: 44px;
    max-width: 72ch;
  }
  .entry h2 {
    margin: 0 0 12px;
    font-size: 21px;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 0;
  }
  dl div {
    display: grid;
    grid-template-columns: minmax(11em, 38%) minmax(0, 1fr);
    gap: 16px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
    scroll-margin-top: 24px;
  }
  dl div:last-child {
    border-bottom: 0;
  }
  dl div:target {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  dt {
    font-weight: 600;
  }
  dd {
    margin: 0;
    color: var(--muted);
  }
  @media (max-width: 560px) {
    dl div {
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
    }
  }
</style>
