<!-- Renders a JSON value from a request. Scalar lists render inline, object arrays and wide flat objects as tables, other objects as fields. -->
<script lang="ts">
  import Value from "./Value.svelte";

  const { value }: { readonly value: unknown } = $props();

  type Obj = Readonly<Record<string, unknown>>;
  const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
  const isScalar = (v: unknown) => v === null || typeof v !== "object";
  /** Returns the keys of an array of plain objects, in first-seen order. Returns null for any other value. */
  const columnsOf = (v: unknown): string[] | null => {
    if (!Array.isArray(v) || v.length === 0 || !v.every(isObj)) return null;
    const keys = new Set<string>();
    for (const o of v) for (const k of Object.keys(o)) keys.add(k);
    return [...keys];
  };
  const keys = $derived(columnsOf(value));
</script>

{#if typeof value === "string"}
  <span class="s" class:short={value.length <= 24}>{value}</span>
{:else if isScalar(value)}
  <span class="n">{String(value)}</span>
{:else if Array.isArray(value) && value.every(isScalar)}
  <span class="list"
    >{#each value as v, i (i)}<span class="item">{String(v)}</span>{/each}</span
  >
{:else if keys !== null && Array.isArray(value)}
  <div class="grid-wrap">
    <table class="rows">
      <thead
        ><tr
          >{#each keys as k (k)}<th>{k}</th>{/each}</tr
        ></thead
      >
      <tbody>
        {#each value as row, i (i)}
          <tr
            >{#each keys as k (k)}<td
                >{#if (row as Obj)[k] !== undefined}<Value value={(row as Obj)[k]} />{/if}</td
              >{/each}</tr
          >
        {/each}
      </tbody>
    </table>
  </div>
{:else if isObj(value) && Object.keys(value).length > 4 && Object.values(value).every(isScalar)}
  <!-- A flat record with more than four fields, such as a table row, renders as one row. -->
  <div class="grid-wrap">
    <table class="rows">
      <thead
        ><tr
          >{#each Object.keys(value) as k (k)}<th>{k}</th>{/each}</tr
        ></thead
      >
      <tbody
        ><tr
          >{#each Object.values(value) as v, i (i)}<td><span class="s short">{String(v)}</span></td>{/each}</tr
        ></tbody
      >
    </table>
  </div>
{:else if isObj(value)}
  <dl class="fields">
    {#each Object.entries(value) as [k, v] (k)}
      <div>
        <dt>{k}</dt>
        <dd><Value value={v} /></dd>
      </div>
    {/each}
  </dl>
{:else}
  <span class="n">{JSON.stringify(value)}</span>
{/if}

<style>
  .s,
  .n,
  .item {
    font: 12.5px/1.5 var(--mono);
  }
  .short {
    white-space: nowrap;
  }
  .list {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px 14px;
  }
  .grid-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .rows {
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .rows th {
    text-align: left;
    font: 500 12px var(--mono);
    color: var(--faint);
    padding: 0 16px 4px 0;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .rows td {
    padding: 4px 16px 4px 0;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .rows tr:last-child td {
    border-bottom: 0;
  }
  .fields {
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .fields div {
    display: grid;
    grid-template-columns: minmax(72px, max-content) minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
  }
  .fields dt {
    font: 500 12px var(--mono);
    color: var(--faint);
  }
  .fields dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
