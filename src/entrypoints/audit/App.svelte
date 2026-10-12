<script lang="ts">
  import { onMount } from 'svelte';
  import Brand from '../../components/Brand.svelte';
  import { auditAction, loadAudit, type AuditTab } from '../../lib/client';

  let tabs = $state<AuditTab[]>([]);
  let filter = $state<'all' | 'sleeping' | 'awake'>('all');
  let search = $state('');
  let loading = $state(true);
  let error = $state('');
  let updated = $state('');
  let busy = $state<number | null>(null);
  let feedback = $state('');
  const sleeping = $derived(tabs.filter((tab) => tab.sleeping).length);
  const visible = $derived(tabs.filter((tab) => (filter === 'all' || tab.sleeping === (filter === 'sleeping')) && `${tab.title} ${tab.url} ${tab.reason} ${tab.phrases?.map((phrase) => phrase.text).join(' ') ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  onMount(() => { void refresh(); });
  async function refresh() {
    loading = true; error = '';
    try { tabs = await loadAudit(); updated = new Date().toLocaleTimeString(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load tabs.'; }
    finally { loading = false; }
  }
  function address(url: string) {
    try { const parsed = new URL(url); return parsed.hostname || parsed.protocol; }
    catch { return 'Address unavailable'; }
  }
  async function act(tab: AuditTab, action: 'sleep' | 'close' | 'focus') {
    busy = tab.id; feedback = ''; error = '';
    try {
      const result = await auditAction(tab.id, action);
      await refresh();
      if (result === 'discarded') feedback = 'Tab is now sleeping.';
      else if (result === 'already-discarded') feedback = 'Tab was already sleeping.';
      else if (result === 'closed') feedback = 'Tab closed.';
      else if (result === 'focused') feedback = 'Switched to the tab.';
      else if (result === 'failed') feedback = 'Chrome could not sleep this tab.';
      else feedback = `Kept awake: ${tabs.find((current) => current.id === tab.id)?.reason ?? 'the safety check could not be completed'}.`;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Tab action failed.'; }
    finally { busy = null; }
  }
</script>

<div class="mx-auto max-w-6xl px-5 py-8 sm:px-10">
  <header class="flex flex-wrap items-center justify-between gap-4">
    <Brand />
    <a class="button" href="options.html">Options ↗</a>
  </header>
  <main class="mt-10">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-3xl font-semibold tracking-tight">Tab Audit</h1><p class="mt-2 text-sm text-muted">See what’s sleeping and what’s keeping your tabs awake.</p></div>
      <button class="button" disabled={loading} onclick={refresh}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    <p class="mt-4 max-w-3xl text-xs leading-relaxed text-muted">A snapshot across all windows. Awake reasons use current tab properties and cached safety checks; opening this page never scans or sleeps tabs. Sleep reasons are available for TabSiesta discards recorded in this browser session.</p>
    <p class="mt-2 text-xs text-muted">Sleep respects your safety rules. Click a tab title to switch to it. Switching wakes sleeping tabs.</p>
    <div class="mt-6 flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-wrap gap-2" aria-label="Tab status filters">
        {#each [{ id: 'all', label: 'All', count: tabs.length }, { id: 'sleeping', label: 'Sleeping', count: sleeping }, { id: 'awake', label: 'Awake', count: tabs.length - sleeping }] as choice (choice.id)}
          <button class="button" class:button-primary={filter === choice.id} aria-pressed={filter === choice.id} onclick={() => { filter = choice.id as typeof filter; }}>{choice.label} · {choice.count}</button>
        {/each}
      </div>
      <label class="flex items-center gap-2 text-sm text-muted">Search <input class="field w-56" type="search" bind:value={search} placeholder="Title, site, or reason" /></label>
    </div>
    {#if error}<p role="alert" class="mt-4 text-sm text-danger">{error}</p>{/if}
    {#if feedback}<p role="status" class="mt-4 text-sm text-accent">{feedback}</p>{/if}
    {#if updated}<p class="mt-4 text-xs text-muted">{visible.length} tabs shown · Updated {updated}</p>{/if}
    <div class="card mt-3 overflow-x-auto">
      <table class="w-full text-left text-sm">
        <caption class="sr-only">Tabs and their sleep or protection reasons</caption>
        <thead class="border-b border-line bg-tint text-xs text-muted"><tr><th scope="col" class="px-5 py-3">Tab</th><th scope="col" class="px-5 py-3">Status</th><th scope="col" class="px-5 py-3">Reason</th><th scope="col" class="px-5 py-3">Actions</th></tr></thead>
        <tbody>
          {#each visible as tab (tab.id)}
            <tr class="border-b border-line last:border-0">
              <td class="max-w-sm px-5 py-4"><button type="button" class="break-words rounded-sm text-left font-medium underline underline-offset-2 hover:text-accent" disabled={loading || busy !== null} aria-label={`Switch to ${tab.title}`} onclick={() => { void act(tab, 'focus'); }}>{tab.title}</button><p class="mt-1 break-all text-xs text-muted">{address(tab.url)} · Window {tab.windowId}</p></td>
              <td class="whitespace-nowrap px-5 py-4"><span class="rounded-full px-2.5 py-1 text-xs" class:bg-tint={tab.sleeping} class:text-accent={tab.sleeping}>{tab.sleeping ? 'Sleeping' : 'Awake'}</span></td>
              <td class="min-w-56 px-5 py-4 text-muted"><p>{tab.reason}</p>{#if tab.phrases?.length}<ul class="mt-2 space-y-1">{#each tab.phrases as phrase (phrase.id)}<li><a class="rounded-sm text-accent underline underline-offset-2 focus-visible:outline-2" href={`options.html#phrase-${encodeURIComponent(phrase.id)}`}>“{phrase.text}”</a><span class="text-xs"> · blocked sleep</span></li>{/each}</ul>{/if}</td>
              <td class="px-5 py-4"><div class="flex gap-2"><button class="button px-3 py-2 text-xs" disabled={loading || busy !== null || tab.sleeping} aria-label={`Sleep ${tab.title}`} onclick={() => { void act(tab, 'sleep'); }}>Sleep</button><button class="button px-3 py-2 text-xs hover:text-danger" disabled={loading || busy !== null} aria-label={`Close ${tab.title}`} onclick={() => { void act(tab, 'close'); }}>Close</button></div></td>
            </tr>
          {:else}
            <tr><td colspan="4" class="px-5 py-10 text-center text-muted">{loading ? 'Loading tabs…' : error ? 'Tabs could not be loaded. Try Refresh.' : 'No tabs match this filter.'}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </main>
</div>
