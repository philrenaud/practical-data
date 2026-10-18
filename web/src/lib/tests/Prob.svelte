<!-- A probability as a bar, with the policy threshold it is held to (when there is one). -->
<script lang="ts">
  interface Props {
    readonly label: string;
    readonly p: number | null;
    readonly threshold?: number;
    /** The option that won; drawn in the accent color. */
    readonly chosen?: boolean;
  }
  const { label, p, threshold, chosen = false }: Props = $props();
  const pct = $derived(p === null ? null : Math.round(p * 100));
</script>

<div class="prob" class:chosen>
  <span class="name">{label}</span>
  <span class="track" aria-hidden="true">
    {#if p !== null}<span class="fill" style:width="{p * 100}%"></span>{/if}
    {#if threshold !== undefined}<span class="tick" style:left="{threshold * 100}%" title="threshold {threshold}"></span>{/if}
  </span>
  <span class="value">{pct === null ? "not asked" : `${pct}%`}</span>
</div>

<style>
  .prob { display: grid; grid-template-columns: minmax(96px, 30%) minmax(0, 1fr) 4.5em; align-items: center; gap: 10px; font-size: 13.5px; padding: 3px 0; }
  .name { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12.5px; }
  .track { position: relative; height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--line) 80%, transparent); }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: color-mix(in srgb, var(--muted) 55%, transparent); }
  .chosen .fill { background: var(--accent); }
  .chosen .name { color: var(--ink); font-weight: 500; }
  .tick { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--ink); opacity: 0.55; }
  .value { text-align: right; font: 12.5px var(--mono); font-variant-numeric: tabular-nums; color: var(--muted); }
  .chosen .value { color: var(--ink); }
</style>
