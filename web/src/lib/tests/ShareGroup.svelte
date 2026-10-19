<!--
  One shared-scale check: each column's own range of values, drawn against the
  scale it was painted on. On one shared scale, the same color is the same value
  in every table; on separate scales, each table stretches its own range.
-->
<script lang="ts">
  import Verdict from "./Verdict.svelte";
  import type { ShareGroup } from "./types.ts";

  const { g }: { readonly g: ShareGroup } = $props();

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
  const shared = $derived(g.members.every((m) => m.domain !== null && m.domain[0] === g.members[0]!.domain?.[0] && m.domain[1] === g.members[0]!.domain?.[1]));
</script>

<figure class="share">
  <figcaption>
    <span class="h">{g.members[0]?.header}</span> in {g.members.length} tables:
    <strong>{shared ? "one shared scale" : "separate scales"}</strong>
    <Verdict ok={g.check.ok} known={g.check.known} />
  </figcaption>
  <div class="rows">
    {#each g.members as m (m.key)}
      <div class="row">
        <a class="t" href="#{m.key.replace(':', '-')}">{m.title}</a>
        <div class="track" aria-hidden="true">
          {#if m.domain}<span class="domain" style:left="{at(m.domain[0])}%" style:width="{at(m.domain[1]) - at(m.domain[0])}%"></span>{/if}
          {#if m.range}<span class="range" style:left="{at(m.range[0])}%" style:width="{Math.max(0.6, at(m.range[1]) - at(m.range[0]))}%"></span>{/if}
        </div>
        <span class="v">{m.range ? `${fmt(m.range[0], m.format)} to ${fmt(m.range[1], m.format)}` : ""}</span>
      </div>
    {/each}
  </div>
  <p class="key">
    <span class="sw range-sw"></span> values in the table
    <span class="sw domain-sw"></span> scale the table is shaded on{#if g.members[0]?.domain}: {fmt(g.members[0].domain[0], g.members[0].format)} to {fmt(g.members[0].domain[1], g.members[0].format)}{/if}
  </p>
</figure>

<style>
  .share { margin: 32px 0 0; padding: 18px 20px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
  figcaption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; font-size: 16px; }
  .h { font-weight: 650; }
  .rows { display: grid; gap: 10px; margin-top: 16px; }
  .row { display: grid; grid-template-columns: minmax(120px, 200px) minmax(0, 1fr) minmax(120px, max-content); align-items: center; gap: 14px; font-size: 14px; }
  .t { color: var(--ink); text-decoration: none; font-weight: 600; overflow-wrap: anywhere; }
  .t:hover { text-decoration: underline; }
  .track { position: relative; height: 14px; border-radius: 7px; background: color-mix(in srgb, var(--line) 60%, transparent); }
  .domain { position: absolute; top: 0; bottom: 0; border-radius: 7px; background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .range { position: absolute; top: 4px; bottom: 4px; border-radius: 3px; background: var(--accent); }
  .v { font: 13px var(--mono); font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
  .key { margin: 14px 0 0; font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .sw { display: inline-block; width: 18px; height: 8px; border-radius: 3px; margin-left: 8px; }
  .sw:first-child { margin-left: 0; }
  .range-sw { background: var(--accent); }
  .domain-sw { background: color-mix(in srgb, var(--accent) 22%, transparent); height: 12px; }
  @media (max-width: 640px) {
    .row { grid-template-columns: minmax(0, 1fr) auto; }
    .track { grid-column: 1 / -1; grid-row: 2; }
  }
</style>
