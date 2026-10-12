<script lang="ts">
  import { onMount } from 'svelte';
  import Brand from '../../components/Brand.svelte';
  import { loadStats, type Stats } from '../../lib/client';

  let stats = $state<Stats | null>(null);
  let error = $state('');
  let showProtectionInfo = $state(false);
  onMount(() => { void refresh(); });
  async function refresh() {
    error = '';
    try { stats = await loadStats(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load tab counts.'; }
  }
  async function openOptions() {
    try { await chrome.runtime.openOptionsPage(); window.close(); }
    catch { error = 'Could not open options. Try again.'; }
  }
</script>

<main class="w-[340px] p-5">
  <Brand small />
  {#if error}
    <p role="alert" class="mt-4 text-sm text-danger">{error}</p>
    <button class="button mt-3" onclick={refresh}>Try again</button>
  {:else if stats}
    <div class="card mt-5 overflow-hidden">
      <div class="flex items-center justify-between border-b border-line px-4 py-3.5">
        <span class="text-sm text-muted">Total tabs</span><span class="text-2xl font-semibold tabular-nums">{stats.total}</span>
      </div>
      <div class="grid grid-cols-2 divide-x divide-line">
        <div class="p-4"><div class="text-3xl font-semibold tracking-tight tabular-nums">{stats.loaded}</div><div class="mt-1 text-xs text-muted">Loaded</div></div>
        <div class="bg-tint p-4"><div class="text-3xl font-semibold tracking-tight text-accent tabular-nums">{stats.discarded}</div><div class="mt-1 text-xs text-muted">Sleeping</div></div>
      </div>
    </div>
    <div class="mt-4 flex items-center gap-2 text-xs text-muted">
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" stroke="currentColor" stroke-width="1.5" /></svg>
      <span>{stats.protected} loaded tabs protected</span>
      <button type="button" aria-label="Explain protected tabs" aria-expanded={showProtectionInfo} aria-controls="protection-info" class="inline-flex size-6 items-center justify-center rounded-full hover:bg-tint focus-visible:outline-2 focus-visible:outline-accent" onclick={() => { showProtectionInfo = !showProtectionInfo; }}>ⓘ</button>
    </div>
    {#if showProtectionInfo}
      <p id="protection-info" class="mt-2 rounded-lg bg-tint p-3 text-xs leading-relaxed text-muted">Protected tabs stay awake because a safety rule applies, such as an active tab, edited form, protected site, or warning phrase. This count also includes pages whose safety has not been verified.</p>
    {/if}
  {:else}
    <p role="status" class="mt-5 py-6 text-sm text-muted">Checking your tabs…</p>
  {/if}
  <button onclick={openOptions} class="button button-primary mt-6 w-full justify-between">Options <span aria-hidden="true">↗</span></button>
  <a href="audit.html" target="_blank" rel="noopener" class="button mt-2 w-full justify-between">Tab Audit <span aria-hidden="true">↗</span></a>
  <p class="mt-3 text-center text-[11px] text-muted">by <a href="https://alex.verver.is" target="_blank" rel="noopener noreferrer" class="rounded-sm underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">ak5</a></p>
</main>
