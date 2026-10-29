<!-- Palette study. Paints the same tables with each diverging palette, on a light and a dark page. -->
<script lang="ts">
  import { PALETTES, type PaletteId } from "../../../../src/core/palettes.ts";
  import type { TableJudgment } from "../../../../src/core/types.ts";
  import { sections } from "#lib/demo.ts";
  import { shade } from "#lib/shade.ts";

  const pick = (id: string, table: number, rows: number) => {
    const s = sections.find((x) => x.section.id === id)!;
    const t = s.page.tables[table]!;
    const j = s.judgment.tables[table]!;
    // The judgment covers the full table. Trim its values to the rows shown.
    const judgment = {
      ...j,
      encodings: j.encodings.map((e) => ({ ...e, values: e.values.slice(0, rows) })),
    } as TableJudgment;
    return { headers: t.headers, rows: t.rows.slice(0, rows), judgment };
  };
  const samples = [pick("pricing", 0, 8), pick("pitching", 0, 7)];
  const palettes = Object.entries(PALETTES) as [PaletteId, (typeof PALETTES)[PaletteId]][];
  const none = new Map<string, number>();
</script>

<svelte:head>
  <title>Palette study</title>
</svelte:head>

<header>
  <h1>Palette study</h1>
  <p>
    The same recorded judgments, painted with each diverging palette on a GitHub-light and a GitHub-dark page. Neutral
    columns (blue) and ranked categories (purple) don't change between palettes.
  </p>
</header>
<main id="study">
  {#each palettes as [id, spec] (id)}
    <section class="palette" {id}>
      <h2>{spec.label}</h2>
      <p class="note">{spec.note}</p>
      <div class="panels">
        {#each ["light", "dark"] as theme (theme)}
          <div class="panel {theme}">
            <h3>{theme}</h3>
            {#each samples as sample, i (i)}
              <table
                use:shade={{ id: `${id}-${theme}-${i}`, judgment: sample.judgment, palette: id, groupSizes: none }}
              >
                <thead
                  ><tr
                    >{#each sample.headers as h, hi (hi)}<th>{h}</th>{/each}</tr
                  ></thead
                >
                <tbody>
                  {#each sample.rows as row, ri (ri)}<tr
                      >{#each row as cell, ci (ci)}<td>{cell}</td>{/each}</tr
                    >{/each}
                </tbody>
              </table>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/each}
</main>

<style>
  :global(:root) {
    --bg: #f4f0e8;
    --ink: #1c1a17;
    --muted: #6b655c;
    --line: #e2dbcf;
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font:
      15px/1.5 var(--font-text),
      sans-serif;
  }
  header {
    max-width: 1320px;
    margin: 0 auto;
    padding: 40px 16px 8px;
  }
  h1 {
    margin: 0;
    font-size: 40px;
    letter-spacing: -0.03em;
  }
  header p {
    color: var(--muted);
    max-width: 70ch;
  }
  .palette {
    max-width: 1320px;
    margin: 0 auto;
    padding: 28px 16px;
    border-top: 1px solid var(--line);
  }
  .palette h2 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  .palette .note {
    margin: 2px 0 14px;
    color: var(--muted);
  }
  .panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .panel {
    border-radius: 12px;
    padding: 14px;
    overflow-x: auto;
  }
  .panel.light {
    background: #ffffff;
    color: #1f2328;
    border: 1px solid #d1d9e0;
  }
  .panel.dark {
    background: #0d1117;
    color: #e6edf3;
    border: 1px solid #30363d;
  }
  .panel h3 {
    margin: 0 0 8px;
    font:
      600 12px "IBM Plex Mono",
      monospace;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.6;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 14px;
    font:
      12.5px/1.35 "IBM Plex Mono",
      monospace;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 5px 8px;
    text-align: left;
    white-space: nowrap;
  }
  .light th,
  .light td {
    border-bottom: 1px solid #d1d9e0;
  }
  .dark th,
  .dark td {
    border-bottom: 1px solid #30363d;
  }
  th {
    font:
      600 11.5px var(--font-label),
      sans-serif;
  }
  @media (max-width: 900px) {
    .panels {
      grid-template-columns: 1fr;
    }
  }
</style>
