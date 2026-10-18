<!-- One column of a test table: what code measured, what was decided and on what evidence, and its hand label. -->
<script lang="ts">
  import type { Policy } from "../../../../src/decide/judge.ts";
  import type { ColumnEncoding, SkippedColumn } from "../../../../src/core/types.ts";
  import { plain } from "./names.ts";
  import Prob from "./Prob.svelte";
  import Verdict from "./Verdict.svelte";
  import type { CheckKind, Profile, ScoredCheck } from "./types.ts";

  const CHECK_NAMES: Readonly<Record<CheckKind, string>> = {
    detect: "shade",
    polarity: "direction",
    transform: "scale",
    order: "order",
    aggregates: "totals",
    shared: "shared",
    orientation: "orientation",
  };

  interface Props {
    readonly header: string;
    readonly encoding: ColumnEncoding | undefined;
    readonly skipped: SkippedColumn | undefined;
    readonly profile: Profile | undefined;
    readonly expected: unknown;
    readonly checks: readonly ScoredCheck[];
    readonly policy: Policy;
  }
  const { header, encoding: e, skipped, profile, expected, checks, policy }: Props = $props();

  const kindLabel = $derived(
    profile === undefined
      ? null
      : profile.kind === "numeric"
        ? `numbers${profile.unit === null ? "" : ` · ${profile.unit}`}`
        : profile.kind === "categorical"
          ? `labels · ${profile.levels.length} levels`
          : "text",
  );
  const label = $derived(
    expected === undefined
      ? "not hand-labeled; not scored"
      : expected === "none"
        ? "label: leave plain"
        : `label: ${plain((expected as { kind: string }).kind)}`,
  );
</script>

<article class="col" class:shaded={e !== undefined}>
  <header>
    <h3>{header || "(blank)"}</h3>
    {#if kindLabel}<span class="kind">{kindLabel}</span>{/if}
  </header>

  {#if profile?.kind === "numeric"}
    <p class="facts"><span class="mono">{profile.samples.slice(0, 4).join("  ")}</span><br>{profile.spread}</p>
  {:else if profile?.kind === "categorical"}
    <p class="facts mono">{profile.levels.slice(0, 8).join(" · ")}{profile.levels.length > 8 ? " …" : ""}</p>
  {/if}

  <p class="decision">
    {#if e === undefined}
      <span class="plain">left plain</span>{skipped ? `: ${skipped.reason}` : ""}
    {:else if e.kind === "quantitative"}
      <span class="on">shaded</span> · {plain(`${e.polarity}/${e.transform}`)}{e.group !== null ? " · shared scale" : ""}
    {:else}
      <span class="on">shaded</span> · {e.order.join(" < ")}
    {/if}
  </p>

  <div class="evidence">
    {#if e?.kind === "quantitative"}
      <Prob label="amount" p={e.evidence.comparable} threshold={policy.measure} chosen />
      <Prob label="higher" p={e.evidence.polarity.higher_is_better} threshold={policy.polarity} chosen={e.polarity === "higher_is_better"} />
      <Prob label="lower" p={e.evidence.polarity.lower_is_better} threshold={policy.polarity} chosen={e.polarity === "lower_is_better"} />
      <Prob label="neither" p={e.evidence.polarity.neutral} chosen={e.polarity === "neutral"} />
      {#if e.evidence.log !== null}<Prob label="log scale" p={e.evidence.log} threshold={policy.log} chosen={e.transform === "log"} />{/if}
    {:else if e?.kind === "ordinal"}
      <Prob label="ordered" p={e.evidence.comparable} threshold={policy.ordinal} chosen />
      <Prob label="order holds" p={e.evidence.orderConfidence} threshold={policy.orderConfidence} chosen />
      {#if e.evidence.comparable < policy.ordinal}
        <p class="note">Shaded on the strong-order rule: P(ordered) ≥ {policy.ordinalWithStrongOrder} with the order at ≥ {policy.strongOrder}.</p>
      {/if}
    {:else if skipped?.comparable != null}
      <Prob label={profile?.kind === "categorical" ? "ordered" : "amount"} p={skipped.comparable} threshold={profile?.kind === "categorical" ? policy.ordinal : policy.measure} />
    {/if}
  </div>

  <div class="foot">
    <span class="label">{label}</span>
    {#each checks as c, i (i)}<Verdict ok={c.ok} known={c.known} label={CHECK_NAMES[c.kind]} />{/each}
  </div>
</article>

<style>
  .col { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--paper); display: grid; gap: 8px; align-content: start; }
  .col.shaded { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  h3 { margin: 0; font-size: 16px; font-weight: 680; overflow-wrap: anywhere; }
  .kind { font: 11.5px var(--mono); color: var(--faint); white-space: nowrap; }
  .facts { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; }
  .decision { margin: 0; font-size: 14px; }
  .note { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
  .on { color: var(--accent); font-weight: 650; }
  .plain { color: var(--muted); font-weight: 650; }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding-top: 8px; border-top: 1px solid var(--line); }
  .label { font: 12px var(--mono); color: var(--faint); margin-right: auto; }
</style>
