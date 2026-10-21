<!--
  A shaded table in a short frame, for an example question. The frame outlines
  the question's column or row and scrolls it into view.
-->
<script lang="ts">
  import { DEFAULT_PALETTE } from "../../../../src/core/palettes.ts";
  import { shade } from "../shade.ts";
  import type { CaseTable } from "./types.ts";

  interface Props {
    readonly t: CaseTable;
    /** The column the question is about (an index into the snapshot's headers). */
    readonly col?: number | null;
    /** The row the question is about (an index into the snapshot's rows). */
    readonly row?: number | null;
  }
  const { t, col = null, row = null }: Props = $props();

  /** Scrolls the frame so that the outlined column and row are in view. Measures positions against the frame, not the page. */
  const focus = (frame: HTMLElement, target: { col: number | null; row: number | null }) => {
    const box = frame.getBoundingClientRect();
    const th = target.col === null ? undefined : frame.querySelectorAll("thead th")[target.col];
    if (th !== undefined)
      frame.scrollLeft = Math.max(0, th.getBoundingClientRect().left - box.left + frame.scrollLeft - 64);
    const tr = target.row === null ? undefined : frame.querySelectorAll("tbody tr")[target.row];
    if (tr !== undefined)
      frame.scrollTop = Math.max(0, tr.getBoundingClientRect().top - box.top + frame.scrollTop - 64);
  };
</script>

<figure class="preview">
  <p class="lead">
    For example,
    {#if col !== null}the column <span class="name">"{t.snapshot.headers[col]}"</span> in {t.title}:
    {:else if row !== null}the row <span class="name">"{t.snapshot.rows[row]?.[0] ?? row + 1}"</span> in {t.title}:
    {:else}the table {t.title}:{/if}
  </p>
  <div class="frame" use:focus={{ col, row }}>
    <table
      use:shade={{
        id: `preview-${t.slug}-${t.id}`,
        judgment: t.judgment,
        palette: DEFAULT_PALETTE,
        groupSizes: t.groupSizes,
      }}
    >
      <thead
        ><tr
          >{#each t.snapshot.headers as h, i (i)}<th scope="col" class:on={i === col}>{h}</th>{/each}</tr
        ></thead
      >
      <tbody>
        {#each t.snapshot.rows as r, ri (ri)}
          <tr class:on={ri === row}
            >{#each r as cell, ci (ci)}<td class:on={ci === col}>{cell}</td>{/each}</tr
          >
        {/each}
      </tbody>
    </table>
  </div>
  <figcaption>
    {t.title} · {#if t.source.url}<a href={t.source.url} rel="noopener">{t.source.label}</a>{:else}{t.source.label}{/if}
  </figcaption>
</figure>

<style>
  .preview {
    margin: 0 0 16px;
  }
  .frame {
    max-height: 236px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    -webkit-overflow-scrolling: touch;
  }
  table {
    border-collapse: collapse;
    min-width: 100%;
    font: 12.5px/1.4 var(--mono);
    font-variant-numeric: tabular-nums;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--paper);
    text-align: left;
    font-family: var(--sans);
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  th,
  td {
    padding: 5px 9px;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  td.on {
    box-shadow:
      inset 2px 0 0 var(--accent),
      inset -2px 0 0 var(--accent);
  }
  th.on {
    box-shadow:
      inset 2px 0 0 var(--accent),
      inset -2px 0 0 var(--accent),
      inset 0 2px 0 var(--accent);
    color: var(--ink);
  }
  tr.on td {
    box-shadow:
      inset 0 2px 0 var(--accent),
      inset 0 -2px 0 var(--accent);
  }
  figcaption {
    margin-top: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  figcaption a {
    color: inherit;
  }
  .lead {
    margin: 0 0 8px;
    font-size: 16px;
  }
  .lead .name {
    font-weight: 650;
    box-shadow: inset 0 -2px 0 var(--accent);
  }
</style>
