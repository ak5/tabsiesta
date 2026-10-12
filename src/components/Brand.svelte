<script lang="ts">
  let { small = false }: { small?: boolean } = $props();
</script>

<div class="flex items-center gap-3">
  <img src="/icons/icon128.png" alt="" width="64" height="64" class="size-16 shrink-0 object-contain" class:size-14={small} />
  <div>
    <div class="text-base font-bold tracking-tight">TabSiesta</div>
    {#if !small}<div class="mt-0.5 text-xs text-muted">A little rest for your tabs.</div>{/if}
  </div>
</div>
