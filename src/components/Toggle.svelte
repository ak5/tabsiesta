<script lang="ts">
  let { id, title, description, checked = $bindable(false) }: {
    id: string; title: string; description: string; checked: boolean;
  } = $props();
</script>

<div class="flex items-start justify-between gap-6 py-5">
  <div>
    <label for={id} class="cursor-pointer text-sm font-semibold">{title}</label>
    <p id={`${id}-description`} class="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{description}</p>
  </div>
  <label class="relative mt-1 inline-flex shrink-0 cursor-pointer items-center">
    <input {id} type="checkbox" bind:checked aria-describedby={`${id}-description`} class="peer sr-only" />
    <span aria-hidden="true" class="h-6 w-11 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"></span>
    <span aria-hidden="true" class="absolute left-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"></span>
  </label>
</div>
