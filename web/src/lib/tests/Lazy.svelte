<!-- A disclosure that renders its contents only after it opens. A table's raw requests can hold hundreds of questions. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    readonly summary: string;
    readonly children: Snippet;
  }
  const { summary, children }: Props = $props();
  let open = $state(false);
</script>

<details class="raw" bind:open>
  <summary>{summary}</summary>
  {#if open}{@render children()}{/if}
</details>
