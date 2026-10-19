<!--
  One shared-scale check, on its data: each table's values of the column,
  shaded by the extension's painter on the scale they were judged to share,
  and each table's range drawn against that scale. On one shared scale, the
  same color is the same value in every table.
-->
<script lang="ts">
  import { DEFAULT_PALETTE } from "../../../../src/core/palettes.ts";
  import type { TableJudgment } from "../../../../src/core/types.ts";
  import { shade } from "../shade.ts";
  import Verdict from "./Verdict.svelte";
  import type { ShareGroup } from "./types.ts";

  const { g }: { readonly g: ShareGroup } = $props();

  type Member = ShareGroup["members"][number];
  const numeric = $derived(g.members.every((m) => m.encoding?.kind !== "ordinal"));
  const extent = $derived.by(() => {
    const ends = g.members.flatMap((m) => [...(m.range ?? []), ...(m.domain ?? [])]);
    return ends.length === 0 ? ([0, 1] as const) : ([Math.min(...ends), Math.max(...ends)] as const);
  });
  const at = (v: number) => (extent[1] === extent[0] ? 0 : ((v - extent[0]) / (extent[1] - extent[0])) * 100);
  /** A number in the column's own format: "$39.00" from a sample like "$129.00". */
  const fmt = (v: number, sample: string) => {
    const m = /^([^\d.-]*)-?[\d,]*(\.(\d+))?(.*)$/.exec(sample.trim());
    const decimals = m?.[3]?.length ?? 0;
    return `${m?.[1] ?? ""}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${m?.[4] ?? ""}`;
  };
  const shared = $derived(g.members.every((m) => m.encoding?.group != null && m.encoding.group === g.members[0]!.encoding?.group));

  /** A two-column judgment for a member's excerpt: the row label, then the shared column, painted as judged. */
  const excerptJudgment = (m: Member): TableJudgment => ({
    id: `share-${m.key}`,
    orientation: "columns",
    rowsScore: null,
    encodings: m.encoding === null ? [] : [{ ...m.encoding, col: 1 }],
    skipped: [],
    aggregateRows: [],
  });
  const first = $derived(g.members[0]!);
</script>

<section class="share">
  <h3>
    <span class="h">{first.header}</span> in {g.members.length} tables:
    {shared ? "one shared scale" : "separate scales"}
    <Verdict ok={g.check.ok} known={g.check.known} />
  </h3>

  <div class="excerpts">
    {#each g.members as m (m.key)}
      <figure class="excerpt">
        <figcaption><a href="#{m.key.replace(':', '-')}">{m.title}</a></figcaption>
        <div class="frame">
          <table use:shade={{ id: `share-${m.key}-${first.header}`, judgment: excerptJudgment(m), palette: DEFAULT_PALETTE, groupSizes: m.groupSizes }}>
            <thead><tr><th scope="col">{m.labelHeader}</th><th scope="col">{m.header}</th></tr></thead>
            <tbody>{#each m.rows as r, i (i)}<tr><td>{r.label}</td><td>{r.cell}</td></tr>{/each}</tbody>
          </table>
        </div>
      </figure>
    {/each}
  </div>

  {#if numeric && first.domain}
    <div class="ranges" aria-label="Each table's values on the scale">
      <div class="axis"><span>{fmt(extent[0], first.format)}</span><span>{fmt(extent[1], first.format)}</span></div>
      {#each g.members as m (m.key)}
        <div class="row">
          <span class="t">{m.title}</span>
          <div class="track">
            {#if m.domain}<span class="domain" style:left="{at(m.domain[0])}%" style:width="{at(m.domain[1]) - at(m.domain[0])}%"></span>{/if}
            {#each m.rows as r, i (i)}{#if r.value !== null}<span class="dot" style:left="{at(r.value)}%" title="{r.label}: {r.cell}"></span>{/if}{/each}
          </div>
          <span class="v">{m.range ? `${fmt(m.range[0], m.format)} to ${fmt(m.range[1], m.format)}` : ""}</span>
        </div>
      {/each}
      <p class="key">Each dot is one row. The band is the scale that the table is shaded on{shared ? ": the same for each table" : ""}.</p>
    </div>
  {/if}
</section>

<style>
  .share { margin: 40px 0 0; padding-bottom: 32px; border-bottom: 1px solid var(--line); }
  h3 { margin: 0 0 14px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; font-size: 19px; font-weight: 650; }
  .h { font-weight: 700; }
  .excerpts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .excerpt { margin: 0; min-width: 0; }
  .excerpt figcaption { margin-bottom: 6px; font-size: 14px; font-weight: 600; }
  .excerpt figcaption a { color: var(--ink); text-decoration: none; }
  .excerpt figcaption a:hover { text-decoration: underline; }
  .frame { max-height: 240px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; width: 100%; font: 12.5px/1.4 var(--mono); font-variant-numeric: tabular-nums; }
  th { position: sticky; top: 0; z-index: 1; background: var(--paper); text-align: left; font-family: var(--sans); font-size: 12px; font-weight: 600; color: var(--muted); }
  th, td { padding: 5px 9px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td:first-child { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

  .ranges { margin-top: 18px; display: grid; gap: 8px; }
  .axis { display: flex; justify-content: space-between; margin-left: calc(min(200px, 30%) + 14px); margin-right: calc(150px + 14px); font: 12px var(--mono); color: var(--faint); }
  .row { display: grid; grid-template-columns: minmax(0, min(200px, 30%)) minmax(0, 1fr) 150px; align-items: center; gap: 14px; font-size: 14px; }
  .t { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { position: relative; height: 16px; border-radius: 8px; background: color-mix(in srgb, var(--line) 50%, transparent); }
  .domain { position: absolute; top: 0; bottom: 0; border-radius: 8px; background: color-mix(in srgb, var(--accent) 20%, transparent); }
  .dot { position: absolute; top: 4px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: var(--accent); opacity: 0.75; }
  .v { font: 12.5px var(--mono); font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
  .key { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
  @media (max-width: 640px) {
    .axis { margin: 0; }
    .row { grid-template-columns: minmax(0, 1fr) auto; }
    .track { grid-column: 1 / -1; grid-row: 2; }
  }
</style>
