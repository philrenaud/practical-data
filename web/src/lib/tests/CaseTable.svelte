<!--
  One test table on a check page. Shows the shaded table, a strip with the
  judgments on each column, and the table's checks of the page's kind.
  Hovering a check outlines its column.
-->
<script lang="ts">
  import { isDateUnit } from "../../../../src/core/dates.ts";
  import { DEFAULT_PALETTE } from "../../../../src/core/palettes.ts";
  import type { ColumnEncoding, SkippedColumn } from "../../../../src/core/types.ts";
  import { plainReason } from "../demo.ts";
  import { shade } from "../shade.ts";
  import { describeValue, evidenceFor } from "./names.ts";
  import Requests from "./Requests.svelte";
  import Verdict from "./Verdict.svelte";
  import type { CaseTable, ScoredCheck } from "./types.ts";

  const { t }: { readonly t: CaseTable } = $props();

  const byRows = $derived(t.judgment.orientation === "rows");
  let pointed = $state<string | null>(null);

  // Outlines are inset shadows on the cells, so drawing one never moves text.
  const outline = $derived(
    t.snapshot.headers.map((h) => {
      if (byRows) return "";
      const failed = t.checks.filter((c) => c.column === h && !c.ok);
      if (pointed !== null && pointed === h) return "o-pointed";
      if (failed.some((c) => c.known === null)) return "o-fail";
      return failed.length > 0 ? "o-known" : "";
    }),
  );
  const firstFailed = $derived(outline.findIndex((o) => o === "o-fail" || o === "o-known"));
  /** Scrolls a wide table sideways so the first failing column is in view. */
  const reveal = (frame: HTMLElement, col: number) => {
    if (col < 0) return;
    const th = frame.querySelectorAll("thead th")[col];
    if (th === undefined) return;
    // Measure against the frame, because offsetLeft is not relative to it.
    const right = th.getBoundingClientRect().right - frame.getBoundingClientRect().left;
    if (right > frame.clientWidth)
      frame.scrollLeft = th.getBoundingClientRect().left - frame.getBoundingClientRect().left - 48;
  };

  const DIRECTION: Readonly<Record<string, string>> = {
    higher_is_better: "higher is better",
    lower_is_better: "lower is better",
    neutral: "no direction",
  };
  /** Returns the judgments on one column as a kind and a detail line. */
  const summary = (
    e: ColumnEncoding | undefined,
    s: SkippedColumn | undefined,
  ): { kind: string; detail: string; on: boolean } => {
    if (e?.kind === "quantitative" && isDateUnit(e.unit))
      return { kind: "Dates", detail: "earliest to latest", on: true };
    if (e?.kind === "quantitative") {
      const parts = [
        DIRECTION[e.polarity]!,
        e.transform === "log" ? "log scale" : "linear",
        ...(e.group === null ? [] : ["shared scale"]),
      ];
      return { kind: "Amount", detail: parts.join(" · "), on: true };
    }
    if (e?.kind === "ordinal")
      return {
        kind: "Ordered labels",
        detail: [`${e.order.length} levels`, ...(e.group === null ? [] : ["shared scale"])].join(" · "),
        on: true,
      };
    return { kind: "Ignored", detail: s === undefined ? "" : plainReason(s.reason), on: false };
  };
  const strip = $derived(
    t.snapshot.headers.map((_, c) =>
      summary(
        t.judgment.encodings.find((e) => e.col === c),
        t.judgment.skipped.find((s) => s.col === c),
      ),
    ),
  );
  // A row-based table's columns are its rows, so its strip is a list of row labels.
  const rowStrip = $derived(
    byRows
      ? [
          ...t.judgment.encodings.map((e) => ({ col: e.col, header: e.header, ...summary(e, undefined) })),
          ...t.judgment.skipped.map((s) => ({ col: s.col, header: s.header, ...summary(undefined, s) })),
        ].sort((a, b) => a.col - b.col)
      : [],
  );
  const totals = $derived(new Set(t.judgment.aggregateRows));

  /** One row of the results table. It is a check, or a judged column with no hand label of this kind, which is not scored. */
  interface Line {
    readonly kind: ScoredCheck["kind"];
    readonly column: string | null;
    readonly expected: string | null;
    readonly actual: string;
    readonly ok: boolean | null;
    readonly known: string | null;
  }
  const kind = $derived(t.checks[0]?.kind);
  /** Returns the judgment on a column in the form that a check of kind `k` records. Returns null if the kind does not apply. */
  const judged = (k: ScoredCheck["kind"], header: string): string | null => {
    const e = t.judgment.encodings.find((x) => x.header === header);
    if (k === "detect") return e === undefined ? "none" : e.kind;
    if (k === "polarity") return e === undefined ? null : e.polarity;
    if (k === "transform") return e?.kind === "quantitative" ? e.transform : null;
    if (k === "order") return e?.kind === "ordinal" ? e.order.join(" < ") : null;
    return null;
  };
  // Whole-table checks come first, then columns from left to right. Detect lists every
  // column. The other column kinds list only the columns that the kind applies to.
  const lines = $derived.by((): Line[] => {
    const tableLevel = t.checks.filter((c) => c.column === null);
    const perColumn = kind === "detect" || kind === "polarity" || kind === "transform" || kind === "order";
    if (!perColumn || byRows || kind === undefined) {
      return [
        ...tableLevel,
        ...t.checks
          .filter((c) => c.column !== null)
          .sort((a, b) => t.snapshot.headers.indexOf(a.column!) - t.snapshot.headers.indexOf(b.column!)),
      ];
    }
    return [
      ...tableLevel,
      ...t.snapshot.headers.flatMap((h): Line[] => {
        const c = t.checks.find((x) => x.column === h);
        if (c !== undefined) return [c];
        const actual = judged(kind, h);
        return actual === null ? [] : [{ kind, column: h, expected: null, actual, ok: null, known: null }];
      }),
    ];
  });
  const where = (c: Line) => (c.column === null ? "Whole table" : c.column || "(no header)");
  const ok = $derived(t.checks.filter((c) => c.ok).length);
  const evidence = $derived(
    lines.map((c) => (c.kind === "shared" || c.kind === "aggregates" ? "" : evidenceFor(c as ScoredCheck, t.judgment))),
  );
  const hasEvidence = $derived(evidence.some((e) => e !== ""));
</script>

<section class="case" id="{t.slug}-{t.id}">
  <header>
    <h3>{t.title}</h3>
    <p class="origin">
      {#if t.source.url}<a href={t.source.url} rel="noopener">{t.source.label}</a>{:else}{t.source.label}{/if}
      · {t.snapshot.headers.length} columns × {t.snapshot.rows.length} rows{#if byRows}
        · read by rows{/if}
    </p>
  </header>

  <div class="frame" use:reveal={firstFailed}>
    <table
      use:shade={{ id: `${t.slug}-${t.id}`, judgment: t.judgment, palette: DEFAULT_PALETTE, groupSizes: t.groupSizes }}
    >
      <thead
        ><tr
          >{#each t.snapshot.headers as h, i (i)}<th scope="col" class={outline[i]}>{h}</th>{/each}</tr
        ></thead
      >
      <tbody>
        {#each t.snapshot.rows as row, ri (ri)}
          <tr class:total={totals.has(ri)}
            >{#each row as cell, ci (ci)}<td class={outline[ci]}>{cell}</td>{/each}</tr
          >
        {/each}
      </tbody>
      {#if !byRows}
        <!-- The extractor skips <tfoot>, so the strip is never read as data. -->
        <tfoot>
          <tr>
            {#each strip as s, i (i)}
              <td class={outline[i]} class:off={!s.on}
                ><span class="k">{s.kind}</span><span class="d">{s.detail}</span></td
              >
            {/each}
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
  {#if totals.size > 0}
    <p class="note">
      {totals.size === 1 ? "Row" : "Rows"}
      {[...totals].map((r) => `${r + 1} (${t.snapshot.rows[r]?.[0] || "no label"})`).join(", ")}
      {totals.size === 1 ? "is a total. It is" : "are totals. They are"} not on the scale and not shaded.
    </p>
  {/if}
  {#if byRows}
    <dl class="rowstrip">
      {#each rowStrip as s (s.col)}
        <div class:off={!s.on}>
          <dt>{s.header || "(no label)"}</dt>
          <dd><span class="k">{s.kind}</span> {s.detail}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  <table class="list results">
    <caption class="sr">Checks on {t.title}: {ok} of {t.checks.length} pass</caption>
    <thead
      ><tr
        ><th scope="col">Column</th><th scope="col">Hand label</th><th scope="col">Judgment</th>{#if hasEvidence}<th
            scope="col">Model</th
          >{/if}<th scope="col">Result</th></tr
      ></thead
    >
    <tbody>
      {#each lines as c, i (i)}
        <tr
          class:failed={c.ok === false}
          class:unscored={c.ok === null}
          onpointerenter={() => (pointed = c.column)}
          onpointerleave={() => (pointed = null)}
        >
          <th scope="row">{where(c)}</th>
          <td data-label="Hand label">{c.expected === null ? "no label" : describeValue(c.kind, c.expected)}</td>
          <td data-label="Judgment">{describeValue(c.kind, c.actual)}</td>
          {#if hasEvidence}<td class="evidence" data-label="Model">{evidence[i]}</td>{/if}
          <td class="result"
            >{#if c.ok === null}<span class="unscored-mark">Not scored</span>{:else}<Verdict
                ok={c.ok}
                known={c.known}
              />{/if}</td
          >
        </tr>
        {#if c.known}
          <tr class="why"
            ><td colspan={hasEvidence ? 5 : 4}><a href="/tests/limitations">Known limitation</a>: {c.known}</td></tr
          >
        {/if}
      {/each}
    </tbody>
  </table>

  {#if t.requests > 0}
    <Requests slug={t.slug} table={t.id} count={t.requests} questions={t.questions} />
  {/if}
</section>

<style>
  .case {
    margin-top: 56px;
    content-visibility: auto;
    contain-intrinsic-size: auto 640px;
  }
  header {
    margin-bottom: 12px;
  }
  h3 {
    margin: 0;
    font-size: 20px;
    font-weight: 680;
    letter-spacing: -0.01em;
  }
  .origin {
    margin: 4px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
  .origin a {
    color: inherit;
  }
  .frame {
    max-height: 460px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    -webkit-overflow-scrolling: touch;
  }
  .frame table {
    border-collapse: collapse;
    min-width: 100%;
    font: 13px/1.4 var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .frame th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--paper);
    text-align: left;
    font-family: var(--sans);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .frame th,
  .frame td {
    padding: 6px 10px;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  .frame tbody tr:last-child td {
    border-bottom: 0;
  }
  tr.total td {
    font-weight: 600;
    box-shadow: inset 0 1px 0 var(--muted);
  }

  tfoot td {
    position: sticky;
    bottom: 0;
    z-index: 1;
    background: color-mix(in srgb, var(--accent) 7%, var(--paper));
    border-top: 2px solid color-mix(in srgb, var(--accent) 40%, var(--line));
    vertical-align: top;
    font-family: var(--sans);
    padding-top: 8px;
    padding-bottom: 8px;
  }
  tfoot .k,
  .rowstrip .k {
    display: block;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--accent);
  }
  tfoot .d {
    display: block;
    font-size: 12px;
    color: var(--muted);
  }
  tfoot td.off .k,
  .rowstrip .off .k {
    color: var(--faint);
    font-weight: 500;
  }
  .rowstrip {
    margin: 12px 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 6px 20px;
    font-size: 13px;
  }
  .rowstrip div {
    display: grid;
    gap: 1px;
  }
  .rowstrip dt {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .rowstrip dd {
    margin: 0;
    color: var(--muted);
  }
  .rowstrip .k {
    display: inline;
  }

  .o-fail {
    --o: var(--fail);
  }
  .o-known {
    --o: var(--known);
  }
  .o-pointed {
    --o: var(--accent);
  }
  td.o-fail,
  td.o-known,
  td.o-pointed {
    box-shadow:
      inset 2px 0 0 var(--o),
      inset -2px 0 0 var(--o);
  }
  th.o-fail,
  th.o-known,
  th.o-pointed {
    box-shadow:
      inset 2px 0 0 var(--o),
      inset -2px 0 0 var(--o),
      inset 0 2px 0 var(--o);
  }
  tfoot td.o-fail,
  tfoot td.o-known,
  tfoot td.o-pointed {
    box-shadow:
      inset 2px 0 0 var(--o),
      inset -2px 0 0 var(--o),
      inset 0 -2px 0 var(--o);
  }

  .note {
    margin: 10px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
  .results {
    margin-top: 14px;
  }
  .results th[scope="row"] {
    font-weight: 600;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .results tbody tr:not(.why):hover > * {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .results tr.failed > * {
    background: color-mix(in srgb, var(--fail) 6%, transparent);
  }
  .evidence {
    font: 12.5px var(--mono);
    color: var(--muted);
    white-space: nowrap;
  }
  tr.why td {
    padding-top: 0;
    color: var(--muted);
    font-size: 14px;
  }
  tr.why a {
    color: var(--known);
    font-weight: 600;
  }
  tr.unscored > * {
    color: var(--faint);
  }
  tr.unscored th[scope="row"] {
    font-weight: 500;
  }
  .unscored-mark {
    font-size: 13.5px;
    color: var(--faint);
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    .results thead {
      display: none;
    }
    .results tbody tr:not(.why) {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }
    .results tbody tr.why {
      display: block;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--line);
    }
    .results tbody tr > * {
      border: 0;
      padding: 0;
      background: none !important;
    }
    .results td[data-label] {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: 6.5em minmax(0, 1fr);
      gap: 8px;
    }
    .results td[data-label]::before {
      content: attr(data-label);
      color: var(--faint);
      font: 13px var(--sans);
    }
    .results td.result {
      grid-row: 1;
      grid-column: 2;
    }
    .evidence {
      white-space: normal;
    }
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
