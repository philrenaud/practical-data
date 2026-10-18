<!-- Pass, documented failure (with why), or failure. -->
<script lang="ts">
  interface Props {
    readonly ok: boolean;
    readonly known?: string | null;
    /** What was checked, shown before the result ("direction: pass"). */
    readonly label?: string;
  }
  const { ok, known = null, label }: Props = $props();
  const prefix = $derived(label === undefined ? "" : `${label} `);
</script>

{#if ok}
  <span class="verdict pass">{prefix}pass</span>
{:else if known !== null}
  <span class="verdict known" title={known}>{prefix}known issue</span>
{:else}
  <span class="verdict fail">{prefix}fail</span>
{/if}
