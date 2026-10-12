<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Brand from '../../components/Brand.svelte';
  import Toggle from '../../components/Toggle.svelte';
  import { loadSettings, saveSettings } from '../../lib/client';
  import { addSuggestedSites, defaultSettings, editPhrase, IDLE_MINUTES, normalizeSite, normalizeText, restoreBehavior, restoreRecommendations, validateSettings, type Settings } from '../../lib/settings';

  let draft = $state<Settings>(defaultSettings());
  let saved = $state('');
  let loaded = $state(false);
  let saving = $state(false);
  let error = $state('');
  let feedback = $state('');
  let newPhrase = $state('');
  let newSite = $state('');
  let search = $state('');
  let activeSection = $state('timing');
  let linkedPhrase = $state('');
  const dirty = $derived(loaded && JSON.stringify(draft) !== saved);
  const visiblePhrases = $derived(draft.phrases.filter((phrase) => normalizeText(phrase.text).includes(normalizeText(search))));
  const sections = [{ id: 'timing', label: 'Sleep behavior', icon: '◷' }, { id: 'protection', label: 'Tab protection', icon: '◇' }, { id: 'phrases', label: 'Sensitive phrases', icon: '≡' }, { id: 'sites', label: 'Protected sites', icon: '⊙' }, { id: 'about', label: 'About & privacy', icon: 'ⓘ' }];
  onMount(() => { void init(); });
  async function init() {
    try { draft = await loadSettings(); saved = JSON.stringify(draft); loaded = true; error = ''; await revealPhrase(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load settings.'; }
  }
  async function save() {
    saving = true; error = ''; feedback = '';
    try { draft = await saveSettings(validateSettings(draft)); saved = JSON.stringify(draft); feedback = 'Settings saved. Your changes are now active.'; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save settings.'; }
    finally { saving = false; }
  }
  async function revealPhrase() {
    let fragment = '';
    try { fragment = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    linkedPhrase = fragment.startsWith('phrase-') ? fragment.slice(7) : '';
    if (!linkedPhrase || !draft.phrases.some((phrase) => phrase.id === linkedPhrase)) return;
    activeSection = 'phrases'; search = '';
    await tick();
    const input = document.getElementById(fragment);
    input?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    input?.focus({ preventScroll: true });
  }
  function addPhrase(event: SubmitEvent) {
    event.preventDefault(); error = '';
    const text = newPhrase.trim();
    if (!text || text.length > 160) { error = 'Enter a phrase with 1–160 characters.'; return; }
    if (draft.phrases.some((p) => normalizeText(p.text) === normalizeText(text))) { error = 'That phrase is already in your list.'; return; }
    draft.phrases.push({ id: `custom-${crypto.randomUUID()}`, text, enabled: true, recommended: false });
    newPhrase = ''; feedback = 'Phrase added. Save to apply.';
  }
  function changePhrase(id: string, text: string) {
    if (!text.trim() || text.trim().length > 160) { error = 'Phrases need 1–160 characters.'; return; }
    const current = draft.phrases.find((p) => p.id === id);
    if (current?.text === text.trim()) return;
    draft = editPhrase(draft, id, text); feedback = 'Phrase edited and retained as a custom entry. Save to apply.';
  }
  function addSite(event: SubmitEvent) {
    event.preventDefault(); error = '';
    try {
      const host = normalizeSite(newSite);
      if (draft.sites.includes(host)) throw new Error('That site is already protected.');
      draft.sites.push(host); newSite = ''; feedback = 'Site added. Save to apply.';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid hostname.'; }
  }
  function restorePhrases() { draft = restoreRecommendations(draft); feedback = 'Recommendations restored. Custom phrases are preserved. Save to apply.'; }
  function restoreSettings() { draft = restoreBehavior(draft); feedback = 'Behavior defaults restored. Your phrase and site lists are preserved. Save to apply.'; }
  function seedSites() {
    const next = addSuggestedSites(draft);
    if (next.sites.length > 500) { error = 'Use at most 500 protected sites.'; return; }
    draft = next; error = ''; feedback = 'Suggested sites added. Your existing sites are preserved. Save to apply.';
  }
</script>

<svelte:window onhashchange={() => { void revealPhrase(); }} onbeforeunload={(event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }} />

<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-panel focus:p-4">Skip to settings</a>
<div class="mx-auto min-h-screen max-w-[1440px] lg:grid lg:grid-cols-[250px_1fr]">
  <aside class="border-b border-line bg-panel px-6 py-6 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0 lg:py-9">
    <Brand />
    <div class="mt-10 hidden lg:block"><p class="eyebrow px-3">Workspace</p></div>
    <nav aria-label="Settings sections" class="mt-4 flex flex-wrap gap-1 lg:mt-3 lg:flex-col">
      <a class="nav-link" href="audit.html"><span aria-hidden="true" class="w-5 text-center text-lg">▤</span>Tab Audit</a>
      {#each sections as section (section.id)}
        <a class="nav-link" class:bg-tint={activeSection === section.id} class:text-accent={activeSection === section.id} href={`#${section.id}`} onclick={() => activeSection = section.id}>
          <span aria-hidden="true" class="w-5 text-center text-lg">{section.icon}</span>{section.label}
        </a>
      {/each}
    </nav>
    <div class="mt-10 hidden rounded-xl bg-tint p-4 lg:block">
      <div class="text-sm font-semibold text-accent">Rest easy</div>
      <p class="mt-2 text-xs leading-relaxed text-muted">Native tab sleeping. No placeholder pages, remote code, or tracking.</p>
    </div>
    <div class="mt-6 hidden text-xs text-muted lg:absolute lg:bottom-7 lg:block">TabSiesta · v{chrome.runtime.getManifest().version}</div>
  </aside>

  <main id="main" class="min-w-0 px-5 py-8 pb-36 sm:px-10 lg:px-14 lg:py-11 lg:pb-36">
    <header class="mb-9 flex flex-wrap items-start justify-between gap-4">
      <div><p class="eyebrow">Make room for what matters</p><h1 class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your tabs. Your rules.</h1><p class="mt-3 max-w-xl text-sm leading-relaxed text-muted">Sleep what you’re not using. Keep your work and one-time information within reach.</p></div>
      <span class="mt-1 rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-medium text-muted">● Runs on your device</span>
    </header>

    {#if !loaded}
      {#if error}<div role="alert" class="card p-6 text-danger">{error}<button class="button ml-4" onclick={init}>Try again</button></div>
      {:else}<p role="status" class="text-muted">Loading your settings…</p>{/if}
    {:else}
      <div class="space-y-7">
        <section id="timing" class="card scroll-mt-6 p-6 sm:p-7">
          <p class="eyebrow">01 / Automation</p><h2 class="section-title mt-2">Sleep behavior</h2>
          <div class="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
            <div><label class="text-sm font-semibold" for="idle">Sleep inactive tabs after</label><p id="idle-help" class="mt-1.5 text-sm text-muted">The timer starts when you switch to another tab. Checked every minute.</p></div>
            <div class="relative w-40">
              <select id="idle" class="field w-full appearance-none pr-10" bind:value={draft.idleMinutes} aria-describedby="idle-help">{#each IDLE_MINUTES as minutes (minutes)}<option value={minutes}>{minutes === 60 ? '1 hour' : `${minutes} minutes`}</option>{/each}</select>
              <svg aria-hidden="true" class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </div>
          </div>
          <Toggle id="collapse" title="Sleep collapsed groups" description="Evaluate a group’s tabs as soon as you collapse it. All safety checks still apply." bind:checked={draft.collapseSleep} />
        </section>

        <section id="protection" class="card scroll-mt-6 p-6 sm:p-7">
          <p class="eyebrow">02 / Guardrails</p><h2 class="section-title mt-2">Keep important tabs awake</h2>
          <div class="mt-2 divide-y divide-line">
            <Toggle id="audio" title="Protect tabs playing audio" description="Keep music, calls, and other audible tabs loaded." bind:checked={draft.protectAudio} />
            <Toggle id="pinned" title="Protect pinned tabs" description="Treat pinned tabs as part of your permanent workspace." bind:checked={draft.protectPinned} />
          </div>
          <div class="rounded-xl bg-tint p-4 text-sm leading-relaxed">
            <p class="font-semibold text-accent">Always protected</p><p class="mt-1 text-muted">Selected tabs in every window, unsaved form changes, and pages we cannot safely check stay awake. Frozen and loading tabs are also skipped.</p>
          </div>
          <p class="mt-4 text-xs leading-relaxed text-muted">For a single page, right-click inside the page and choose <strong>Keep this tab awake</strong>. It stays protected until the tab closes.</p>
        </section>

        <section id="phrases" class="card scroll-mt-6 p-6 sm:p-7">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><p class="eyebrow">03 / One-time information</p><h2 class="section-title mt-2">Sensitive phrases</h2></div><span class="rounded-full bg-tint px-3 py-1 text-xs font-medium text-accent">{draft.phrases.filter((p) => p.enabled).length} enabled</span></div>
          <Toggle id="phrases-enabled" title="Protect pages containing these phrases" description="Look for visible warnings about one-time keys, recovery codes, and crypto secrets. A match protects the document even after the warning disappears." bind:checked={draft.phraseGuard} />
          <div class="border-t border-line"><Toggle id="recommendations" title="Add new recommended phrases on update" description="Add new recommendations when TabSiesta updates. Your edits, disabled phrases, and previous removals are respected." bind:checked={draft.addRecommendations} /></div>
          <form class="mt-1 flex flex-wrap gap-2" onsubmit={addPhrase}>
            <label class="sr-only" for="new-phrase">New sensitive phrase</label><input id="new-phrase" class="field min-w-48 flex-1" maxlength="160" placeholder="e.g. Download your backup codes" bind:value={newPhrase} /><button class="button" type="submit">+ Add phrase</button>
          </form>
          <p class="mt-2 text-xs leading-relaxed text-muted">Add warning wording, never actual keys or recovery words. Custom phrases are saved in this device’s settings.</p>
          <div class="mt-5 flex flex-wrap items-center justify-between gap-3"><label class="sr-only" for="phrase-search">Filter phrases</label><input id="phrase-search" class="field w-full sm:w-64" placeholder="Filter phrases…" bind:value={search} /><button type="button" class="text-xs font-semibold text-accent underline-offset-4 hover:underline" onclick={restorePhrases}>Restore recommended phrases</button></div>
          <div class="mt-3 max-h-[420px] overflow-y-auto rounded-xl border border-line">
            {#each visiblePhrases as phrase (phrase.id)}
              <div class="flex items-center gap-3 border-b border-line p-3 last:border-b-0" class:bg-tint={linkedPhrase === phrase.id}>
                <input type="checkbox" class="size-4 shrink-0" aria-label={`Enable ${phrase.text}`} bind:checked={phrase.enabled} />
                <div class="flex min-w-0 flex-1 items-center gap-2"><label class="sr-only" for={`phrase-${phrase.id}`}>Phrase text</label><input id={`phrase-${phrase.id}`} class="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-sm hover:border-line focus:border-line" value={phrase.text} maxlength="160" onchange={(event) => changePhrase(phrase.id, event.currentTarget.value)} />{#if !phrase.recommended}<span class="shrink-0 text-[10px] tracking-wide text-muted">CUSTOM</span>{/if}</div>
                {#if !phrase.recommended}<button class="shrink-0 rounded p-2 text-muted hover:bg-tint hover:text-danger" aria-label={`Remove ${phrase.text}`} onclick={() => { draft.phrases = draft.phrases.filter((p) => p.id !== phrase.id); }}>×</button>{/if}
              </div>
            {:else}<p class="p-5 text-sm text-muted">{search ? 'No matching phrases.' : 'No phrases yet. Add your own or restore recommendations.'}</p>{/each}
          </div>
          <p class="mt-3 text-xs leading-relaxed text-muted">Literal matching ignores case and extra whitespace. Restore keeps your custom entries and edited variants. Page text and secrets never leave the page.</p>
        </section>

        <section id="sites" class="card scroll-mt-6 p-6 sm:p-7">
          <p class="eyebrow">04 / Your exceptions</p><h2 class="section-title mt-2">Never sleep these sites</h2><p class="mt-2 text-sm leading-relaxed text-muted">Protect a hostname and all its subdomains from both automatic triggers.</p>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3"><p class="max-w-xl text-xs leading-relaxed text-muted">New installs start with common mail, documents, chat, and password vaults. Every entry is removable. Updates keep your saved list.</p><button type="button" class="button shrink-0 text-xs" onclick={seedSites}>Add suggested sites</button></div>
          <form class="mt-5 flex flex-wrap gap-2" onsubmit={addSite}><label class="sr-only" for="new-site">Protected hostname</label><input id="new-site" class="field min-w-48 flex-1" placeholder="example.com" bind:value={newSite} /><button type="submit" class="button">+ Add site</button></form>
          {#if draft.sites.length}<ul class="mt-4 divide-y divide-line">{#each draft.sites as site (site)}<li class="flex items-center justify-between py-3 text-sm"><span class="font-mono">{site}</span><button class="rounded px-3 py-1 text-xs text-muted hover:bg-tint hover:text-danger" aria-label={`Remove ${site}`} onclick={() => draft.sites = draft.sites.filter((s) => s !== site)}>Remove</button></li>{/each}</ul>
          {:else}<div class="mt-4 rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">No site exceptions. Your safety guards still apply.</div>{/if}
        </section>

        <section id="about" class="scroll-mt-6 px-1">
          <h2 class="section-title">Small footprint. Clear boundaries.</h2>
          <div class="mt-4 grid gap-5 text-sm leading-relaxed text-muted sm:grid-cols-2">
            <div><h3 class="font-semibold text-ink">Why site access?</h3><p class="mt-1">TabSiesta checks forms and visible phrases inside web pages and frames before sleeping them. Unchecked or inaccessible pages stay awake.</p></div>
            <div><h3 class="font-semibold text-ink">What stays private?</h3><p class="mt-1">No tracking, network requests, or browsing history. Settings stay on this device. Form values and secrets are never saved to extension storage or sent anywhere.</p></div>
            <div><h3 class="font-semibold text-ink">How sleeping works</h3><p class="mt-1">Chrome unloads the page while keeping its original address and icon. Selecting a sleeping tab reloads it. Group expansion alone does not reload tabs.</p></div>
            <div><h3 class="font-semibold text-ink">Protection has limits</h3><p class="mt-1">Custom editors, closed shadow roots, and unfamiliar warnings may escape detection. Use site or tab protection for important pages. These guards cannot prevent crashes, manual reloads, or another extension’s actions.</p></div>
          </div>
          <button class="mt-6 text-sm font-semibold text-accent underline-offset-4 hover:underline" onclick={restoreSettings}>Restore behavior defaults</button><p class="mt-1 text-xs text-muted">Keeps your custom phrase and protected-site lists.</p>
        </section>
      </div>
    {/if}
  </main>
</div>

{#if loaded}
  <footer class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel/95 backdrop-blur-sm lg:left-[max(250px,calc((100vw-1440px)/2+250px))]">
    <div class="mx-auto flex max-w-[1190px] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-10 lg:px-14">
      <div class="min-w-0 flex-1"><p role={error ? 'alert' : 'status'} class="text-sm" class:text-danger={!!error} class:text-muted={!error}>{error || (dirty ? feedback || 'You have unsaved changes.' : feedback || 'All changes saved.')}</p></div>
      <button class="button button-primary shrink-0" disabled={saving || !dirty} onclick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  </footer>
{/if}
