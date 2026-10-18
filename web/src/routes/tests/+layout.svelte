<!-- The tests site: every check the eval makes, and how each answer was reached. -->
<script lang="ts">
  import "../../app.css";
  import "#lib/tests/docs.css";
  import { page } from "$app/state";
  import { KINDS } from "#lib/tests/kinds.ts";

  const { data, children } = $props();
  const here = (href: string) => (page.url.pathname === href ? "page" : undefined);
</script>

<div class="docs">
  <header class="docs-bar">
    <div class="docs-bar-inner">
      <a class="docs-brand" href="/"><img src="/icon128.png" alt="" width="20" height="20"> Practical Data <span class="crumb">/ tests</span></a>
      <p class="docs-run">replayed offline · <b>{data.run.requests}</b> recorded requests · <b>{data.run.model}</b></p>
    </div>
  </header>
  <div class="docs-body">
    <nav class="docs-nav" aria-label="Tests">
      <section>
        <h2>Overview</h2>
        <ul><li><a href="/tests" aria-current={here("/tests")}>How it's tested</a></li></ul>
      </section>
      <section>
        <h2>Checks</h2>
        <ul>
          {#each KINDS as k (k.kind)}
            {@const t = data.totals[k.kind]}
            <li>
              <a href="/tests/checks/{k.slug}" aria-current={here(`/tests/checks/${k.slug}`)}>
                <span>{k.title}</span><span class="count" class:bad={t.ok < t.total}>{t.ok}/{t.total}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
      <section>
        <h2>Code</h2>
        <ul>
          <li><a href="/tests/units" aria-current={here("/tests/units")}><span>Unit tests & parsing</span><span class="count" class:bad={!data.unitsOk}>{data.unitCount}</span></a></li>
        </ul>
      </section>
      <section class="pages">
        <h2>Test pages</h2>
        <ul>
          {#each data.pages as p (p.slug)}
            <li>
              <a href="/tests/pages/{p.slug}" aria-current={here(`/tests/pages/${p.slug}`)}>
                <span>{p.name}</span><span class="count" class:bad={p.score[0] < p.score[1]}>{p.score[0]}/{p.score[1]}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    </nav>
    <main class="docs-main">
      {@render children()}
    </main>
  </div>
</div>
