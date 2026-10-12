import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import Options from '../src/entrypoints/options/App.svelte';
import Popup from '../src/entrypoints/popup/App.svelte';
import Audit from '../src/entrypoints/audit/App.svelte';
import { defaultSettings, SUGGESTED_SITES, type Settings } from '../src/lib/settings';

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (component) await unmount(component); component = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function mockApi(initial = defaultSettings()) {
  let settings = structuredClone(initial);
  const sendMessage = vi.fn(async (request: { type: string; settings?: Settings }): Promise<Record<string, unknown>> => {
    if (request.type === 'GET_SETTINGS') return { settings: structuredClone(settings) };
    if (request.type === 'SAVE_SETTINGS') { settings = structuredClone(request.settings!); return { settings: structuredClone(settings) }; }
    return { stats: { total: 9, loaded: 6, discarded: 3, protected: 4 } };
  });
  const openOptionsPage = vi.fn(async () => {});
  vi.stubGlobal('chrome', { runtime: { sendMessage, getManifest: () => ({ version: '0.1.0' }), openOptionsPage } });
  return { sendMessage, openOptionsPage, settings: () => settings };
}
function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}
async function renderOptions(settings = defaultSettings()) {
  const api = mockApi(settings); const target = document.createElement('div'); document.body.append(target);
  component = mount(Options, { target });
  await vi.waitFor(() => expect(document.querySelector('#idle')).not.toBeNull());
  await tick(); return api;
}

describe('options UI', () => {
  it('focuses a linked phrase after settings have loaded', async () => {
    const previous = window.location.hash;
    window.history.replaceState({}, '', '#phrase-crypto-2');
    try {
      await renderOptions();
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('phrase-crypto-2'));
    } finally { window.history.replaceState({}, '', previous || window.location.pathname); }
  });
  it('shows loaded defaults and saves changes through the worker', async () => {
    const api = await renderOptions();
    const idle = document.querySelector<HTMLSelectElement>('#idle')!;
    expect(idle.value).toBe('10');
    idle.value = '30'; idle.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    button('Save changes').click();
    await vi.waitFor(() => expect(api.settings().idleMinutes).toBe(30));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Settings saved. Your changes are now active.'));
  });
  it('restores recommendations while preserving a user-added phrase', async () => {
    await renderOptions();
    const input = document.querySelector<HTMLInputElement>('#new-phrase')!;
    input.value = 'A custom recovery warning'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick();
    button('Restore recommended phrases').click(); await tick();
    expect([...document.querySelectorAll<HTMLInputElement>('input[id^="phrase-"]')].some((input) => input.value === 'A custom recovery warning')).toBe(true);
  });
  it('keeps the form guard explanation permanent and supports protected sites', async () => {
    const api = await renderOptions(); expect(document.body.textContent).toContain('Always protected');
    const input = document.querySelector<HTMLInputElement>('#new-site')!;
    input.value = 'example.com'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick();
    button('Save changes').click(); await vi.waitFor(() => expect(api.settings().sites).toEqual([...SUGGESTED_SITES, 'example.com']));
  });
  it('reports errors without pretending a save succeeded', async () => {
    const api = await renderOptions();
    const pinned = document.querySelector<HTMLInputElement>('#pinned')!;
    pinned.checked = false; pinned.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    api.sendMessage.mockRejectedValueOnce(new Error('Storage is unavailable.'));
    button('Save changes').click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Storage is unavailable.'));
  });
});

describe('popup UI', () => {
  it('shows live counts and an options link, with no sleep controls', async () => {
    const api = mockApi(); const target = document.createElement('div'); document.body.append(target);
    component = mount(Popup, { target });
    await vi.waitFor(() => expect(document.body.textContent).toContain('4 loaded tabs protected'));
    expect(document.body.textContent).toContain('Total tabs'); expect(document.body.textContent).toContain('Sleeping');
    expect(document.querySelectorAll('button')).toHaveLength(2);
    const info = document.querySelector<HTMLButtonElement>('button[aria-label="Explain protected tabs"]')!;
    expect(info.getAttribute('aria-expanded')).toBe('false');
    info.click();
    await vi.waitFor(() => expect(document.getElementById('protection-info')?.textContent).toContain('safety has not been verified'));
    expect(info.getAttribute('aria-expanded')).toBe('true');
    info.click();
    await vi.waitFor(() => expect(document.getElementById('protection-info')).toBeNull());
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    button('Options ↗').click(); await vi.waitFor(() => expect(api.openOptionsPage).toHaveBeenCalledOnce());
    close.mockRestore();
  });
});

describe('tab audit UI', () => {
  it('filters all, sleeping, and awake tabs and searches reasons', async () => {
    const api = mockApi();
    api.sendMessage.mockResolvedValue({ tabs: [
      { id: 1, windowId: 1, title: 'Sleeping example', url: 'https://example.test/', sleeping: true, reason: 'TabSiesta idle timer' },
      { id: 2, windowId: 2, title: 'Awake example', url: 'https://other.test/', sleeping: false, reason: 'Playing audio', phrases: [{ id: 'crypto-2', text: 'Seed phrase' }] },
    ] });
    const target = document.createElement('div'); document.body.append(target);
    component = mount(Audit, { target });
    await vi.waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(2));
    button('Sleeping · 1').click(); await tick();
    expect(document.querySelector('tbody')?.textContent).toContain('Sleeping example');
    expect(document.querySelector('tbody')?.textContent).not.toContain('Awake example');
    button('Awake · 1').click(); await tick();
    expect(document.querySelector('tbody')?.textContent).toContain('Playing audio');
    button('All · 2').click(); await tick();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'audio'; search.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(document.querySelector('tbody')?.textContent).toContain('Awake example');
    expect(api.sendMessage).toHaveBeenCalledWith({ type: 'GET_AUDIT' });
    expect(document.querySelector<HTMLAnchorElement>('a[href="options.html#phrase-crypto-2"]')?.textContent).toContain('Seed phrase');
  });
  it('sleeps, switches through a tab title, and closes a row through audit actions', async () => {
    const api = mockApi();
    let tabs = [{ id: 1, windowId: 1, title: 'Example', url: 'https://example.test/', sleeping: false, reason: 'Idle threshold not reached' }];
    api.sendMessage.mockImplementation(async (message) => {
      const request = message as { type: string; action?: string };
      if (request.type === 'GET_AUDIT') return { tabs: structuredClone(tabs) };
      if (request.action === 'sleep') { tabs[0]!.sleeping = true; return { result: 'discarded' }; }
      if (request.action === 'focus') { tabs[0]!.sleeping = false; return { result: 'focused' }; }
      if (request.action === 'close') { tabs = []; return { result: 'closed' }; }
      return {};
    });
    const target = document.createElement('div'); document.body.append(target);
    component = mount(Audit, { target });
    await vi.waitFor(() => expect(document.querySelector('button[aria-label="Sleep Example"]')).not.toBeNull());
    button('Sleep').click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('now sleeping'));
    expect(api.sendMessage).toHaveBeenCalledWith({ type: 'AUDIT_ACTION', tabId: 1, action: 'sleep' });
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Sleep Example"]')?.disabled).toBe(true);
    button('Example').click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('Switched to the tab.'));
    expect(api.sendMessage).toHaveBeenCalledWith({ type: 'AUDIT_ACTION', tabId: 1, action: 'focus' });
    button('Close').click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('Tab closed'));
    expect(document.querySelector('tbody')?.textContent).not.toContain('Example');
  });
});
