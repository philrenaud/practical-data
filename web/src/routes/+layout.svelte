<script lang="ts">
  const { children } = $props();

  // Trial typography, on the dev server only. See lib/trial-type.css.
  if (import.meta.env.DEV) void import("#lib/trial-type.css");
</script>

{@render children()}
