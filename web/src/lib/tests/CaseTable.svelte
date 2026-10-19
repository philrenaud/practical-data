<!--
  One test table on a check page: the table as the extension shades it, and the
  checks made on it. Pointing at a check outlines its column in the table.
-->
<script lang="ts">
  import { DEFAULT_PALETTE } from "../../../../src/core/palettes.ts";
  import { shade } from "../shade.ts";
  import { describeValue, evidenceFor } from "./names.ts";
  import Requests from "./Requests.svelte";
  import Verdict from "./Verdict.svelte";
  import type { CaseTable, ScoredCheck } from "./types.ts";

  const { t }: { readonly t: CaseTable } = $props();

  const byRows = $derived(t.judgment.orientation === "rows");
  let pointed = $state<string | null>(null);
  const failedOn = (header: string) => t.checks.filter((c) => c.column === header && !c.ok);
  // Columns can only be outlined when the table is read by columns; a row-based table's "columns" are its rows.
  const cols = $derived(
    t.snapshot.headers.map((h) => {
      const failed = byRows ? [] : failedOn(h);
      return {
        fail: failed.some((c) => c.known === null),
        known: failed.length > 0 && failed.every((c) => c.known !== null),
        pointed: !byRows && pointed !== null && pointed === h,
      };
    }),
  );
  const firstFailed = $derived(byRows ? -1 : cols.findIndex((c) => c.fail || c.known));
  /** Scrolls a wide table sideways so the first failing column is in view. */
  const reveal = (frame: HTMLElement, col: number) => {
    if (col < 0) return;
    const th = frame.querySelectorAll("thead th")[col] as HTMLElement | undefined;
    if (th !== undefined && th.offsetLeft + th.offsetWidth > frame.clientWidth) frame.scrollLeft = th.offsetLeft - 48;
  };
  const where = (c: ScoredCheck) => (c.column === null ? "Whole table" : c.column || "(no header)");
  const ok = $derived(t.checks.filter((c) => c.ok).length);
  const evidence = $derived(t.checks.map((c) => evidenceFor(c, t.judgment)));
  const hasEvidence = $derived(evidence.some((e) => e !== ""));
</script>

<section class="case" id="{t.slug}-{t.id}">
  <header>
    <h3>{t.title}</h3>
    <p class="origin">
      {#if t.source.url}<a href={t.source.url} rel="noopener">{t.source.label}</a>{:else}{t.source.label}{/if}
      · {t.snapshot.headers.length} columns × {t.snapshot.rows.length} rows{#if byRows} · read by rows{/if}
    </p>
  </header>

  <div class="frame" use:reveal={firstFailed}>
    <table use:shade={{ id: `${t.slug}-${t.id}`, judgment: t.judgment, palette: DEFAULT_PALETTE, groupSizes: t.groupSizes }}>
      <colgroup>{#each cols as c, i (i)}<col class:fail={c.fail} class:known={c.known} class:pointed={c.pointed}>{/each}</colgroup>
      <thead><tr>{#each t.snapshot.headers as h, i (i)}<th scope="col">{h}</th>{/each}</tr></thead>
      <tbody>
        {#each t.snapshot.rows as row, ri (ri)}<tr>{#each row as cell, ci (ci)}<td>{cell}</td>{/each}</tr>{/each}
      </tbody>
    </table>
  </div>

  <div>
    <table class="list results">
      <caption class="sr">Checks on {t.title}: {ok} of {t.checks.length} pass</caption>
      <thead><tr><th scope="col">Column</th><th scope="col">Hand label</th><th scope="col">Judgment</th>{#if hasEvidence}<th scope="col">Model</th>{/if}<th scope="col">Result</th></tr></thead>
      <tbody>
        {#each t.checks as c, i (i)}
          <tr
            class:failed={!c.ok}
            onpointerenter={() => (pointed = c.column)}
            onpointerleave={() => (pointed = null)}
          >
            <th scope="row">{where(c)}</th>
            <td data-label="Hand label">{describeValue(c.kind, c.expected)}</td>
            <td data-label="Judgment">{describeValue(c.kind, c.actual)}</td>
            {#if hasEvidence}<td class="evidence" data-label="Model">{evidence[i]}</td>{/if}
            <td class="result"><Verdict ok={c.ok} known={c.known} /></td>
          </tr>
          {#if c.known}
            <tr class="why"><td colspan={hasEvidence ? 5 : 4}>Known issue: {c.known}</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>

  {#if t.requests > 0}
    <Requests slug={t.slug} table={t.id} count={t.requests} />
  {/if}
</section>

<style>
  .case { margin-top: 56px; content-visibility: auto; contain-intrinsic-size: auto 640px; }
  header { margin-bottom: 12px; }
  h3 { margin: 0; font-size: 20px; font-weight: 680; letter-spacing: -0.01em; }
  .origin { margin: 4px 0 0; font-size: 14px; color: var(--muted); }
  .origin a { color: inherit; }
  .frame { max-height: 420px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); -webkit-overflow-scrolling: touch; }
  .frame table { border-collapse: collapse; min-width: 100%; font: 13px/1.4 var(--mono); font-variant-numeric: tabular-nums; }
  .frame th { position: sticky; top: 0; z-index: 1; background: var(--paper); text-align: left; font-family: var(--sans); font-size: 12.5px; font-weight: 600; color: var(--muted); }
  .frame th, .frame td { padding: 6px 10px; white-space: nowrap; border-bottom: 1px solid var(--line); }
  .frame tbody tr:last-child td { border-bottom: 0; }
  /* Collapsed borders on <col> frame a whole column without touching the cells the painter colors. */
  col.known { border: 2px solid var(--known); }
  col.fail { border: 2px solid var(--fail); }
  col.pointed { border: 2px solid var(--accent); }
  .results { margin-top: 14px; }
  .results th[scope="row"] { font-weight: 600; text-align: left; overflow-wrap: anywhere; }
  .results tbody tr:not(.why):hover > * { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .results tr.failed > * { background: color-mix(in srgb, var(--fail) 6%, transparent); }
  .evidence { font: 12.5px var(--mono); color: var(--muted); white-space: nowrap; }
  tr.why td { padding-top: 0; color: var(--muted); font-size: 14px; }
  @media (max-width: 640px) {
    .results thead { display: none; }
    .results tbody tr:not(.why) { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
    .results tbody tr.why { display: block; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
    .results tbody tr > * { border: 0; padding: 0; background: none !important; }
    .results td[data-label] { grid-column: 1 / -1; display: grid; grid-template-columns: 6.5em minmax(0, 1fr); gap: 8px; }
    .results td[data-label]::before { content: attr(data-label); color: var(--faint); font: 13px var(--sans); }
    .results td.result { grid-row: 1; grid-column: 2; }
    .evidence { white-space: normal; }
  }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
