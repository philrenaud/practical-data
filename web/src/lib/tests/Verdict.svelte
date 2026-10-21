<!-- A pass, fail, or known-limitation badge. The caller shows the reason for a known limitation. -->
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
  <span class="verdict known">Known limitation</span>
{:else}
  <span class="verdict fail">Fail</span>
{/if}
