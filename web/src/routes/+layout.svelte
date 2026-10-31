<script lang="ts">
  import { init } from "#lib/analytics.ts";

  const { children } = $props();
  // Effects run only in the browser, never during prerender.
  $effect(() => init());
</script>

{@render children()}
