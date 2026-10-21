<!-- One home page example. Shows its tables, shaded by the extension's painter, and the judgment on each column. -->
<script lang="ts">
  import type { PaletteId } from "../../../src/core/palettes.ts";
  import type { ColumnEncoding, SkippedColumn } from "../../../src/core/types.ts";
  import { confidenceOf, describeEncoding, groupSizes, plainReason, type DemoSection } from "./demo.ts";
  import { shade } from "./shade.ts";

  interface Props {
    readonly section: DemoSection;
    readonly index: number;
    readonly palette: PaletteId;
    readonly colored: boolean;
    readonly theme: string;
  }
  const { section: s, index, palette, colored, theme }: Props = $props();

  const groups = $derived(groupSizes(s.judgment));
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

  type Row = { header: string; e: ColumnEncoding | undefined; skipped: SkippedColumn | undefined };
  const rowsOf = (t: number): Row[] =>
    s.page.tables[t]!.headers.map((header, col) => ({
      header,
      e: s.judgment.tables[t]!.encodings.find((x) => x.col === col),
      skipped: s.judgment.tables[t]!.skipped.find((x) => x.col === col),
    }));
</script>

<article class="example" id={s.section.id}>
  <header>
    <span class="index">{String(index + 1).padStart(2, "0")}</span>
    <h3>{s.section.heading}</h3>
  </header>
  <p class="caption">{s.section.caption}</p>
  {#if s.section.source !== ""}
    <a class="source" href={s.section.source} rel="noopener">{host(s.section.source)}</a>
  {:else}
    <span class="source">synthetic test page</span>
  {/if}

  {#each s.page.tables as t, ti (t.id)}
    {@const j = s.judgment.tables[ti]!}
    <div class="table-scroll">
      <table use:shade={{ id: t.id, judgment: j, palette, groupSizes: groups, colored, theme }}>
        {#if t.title !== null}<caption>{t.title}</caption>{/if}
        <thead>
          <tr
            >{#each t.headers as h, hi (hi)}<th scope="col">{h}</th>{/each}</tr
          >
        </thead>
        <tbody>
          {#each t.rows as row, ri (ri)}
            <tr
              >{#each row as cell, ci (ci)}<td>{cell}</td>{/each}</tr
            >
          {/each}
        </tbody>
      </table>
    </div>
    <details class="why">
      <summary>How it read {t.title ?? "this table"}</summary>
      <ul>
        {#each rowsOf(ti) as r, ri (ri)}
          <li class:plain={r.e === undefined}>
            <span class="col">{r.header || "(blank)"}</span>
            <span class="verdict"
              >{r.e !== undefined ? describeEncoding(r.e) : `left plain: ${plainReason(r.skipped?.reason)}`}</span
            >
            <span class="conf">{r.e !== undefined ? confidenceOf(r.e) : ""}</span>
          </li>
        {/each}
      </ul>
      {#if j.aggregateRows.length > 0}
        <p class="agg">
          Rows judged to be totals and kept out of the scale: {j.aggregateRows
            .map((r) => `"${t.rows[r]?.[0] ?? r}"`)
            .join(", ")}.
        </p>
      {/if}
    </details>
  {/each}
</article>
