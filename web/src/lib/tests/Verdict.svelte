<!-- Pass, known issue (the reason is shown where the failure is listed), or fail. -->
<script lang="ts">
  interface Props {
    readonly ok: boolean;
    readonly known?: string | null;
  }
  const { ok, known = null }: Props = $props();
</script>

{#if ok}
  <span class="verdict pass">Pass</span>
{:else if known !== null}
  <span class="verdict known">Known issue</span>
{:else}
  <span class="verdict fail">Fail</span>
{/if}
