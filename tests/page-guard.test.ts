import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageGuard, type PageGuard } from '../src/lib/page-guard';
import { defaultSettings } from '../src/lib/settings';
import { createDiscardEngine, type DiscardTrigger, type EngineDependencies } from '../src/lib/engine';

let guard: PageGuard | undefined;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { guard?.dispose(); guard = undefined; vi.useRealTimers(); });
function install(html: string, late = false) {
  document.body.innerHTML = html;
  guard = createPageGuard(document, defaultSettings(), vi.fn(), late);
  return guard;
}
describe('form guard', () => {
  it.each(['text', 'password', 'email', 'number'])('protects edited %s fields', (type) => {
    const instance = install(`<input type="${type}">`);
    const field = document.querySelector('input')!; field.value = type === 'number' ? '123' : 'draft';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(instance.status().dirty).toBe(true);
  });
  it('protects file selection without reading the file', () => {
    const instance = install('<input type="file">');
    const input = document.querySelector('input')!;
    Object.defineProperty(input, 'files', { value: { length: 1 } });
    expect(instance.status().dirty).toBe(true);
  });
  it('protects programmatically changed textarea/select/checkbox state', () => {
    const instance = install('<textarea></textarea><select><option>A</option><option>B</option></select><input type="checkbox">');
    expect(instance.status().dirty).toBe(false);
    document.querySelector('select')!.selectedIndex = 1;
    expect(instance.status().dirty).toBe(true);
  });
  it('protects programmatic textarea changes without an input event', () => {
    const instance = install('<textarea>Original</textarea>');
    document.querySelector('textarea')!.value = 'Unsaved draft';
    expect(instance.status().dirty).toBe(true);
  });
  it.each(['checkbox', 'radio'])('protects changed %s state', (type) => {
    const instance = install(`<input type="${type}">`);
    document.querySelector('input')!.checked = true;
    expect(instance.status().dirty).toBe(true);
  });
  it('finds newly added fields and contenteditable changes', () => {
    const instance = install('<div contenteditable="true">Original</div>');
    document.querySelector('div')!.textContent = 'My draft';
    expect(instance.status().dirty).toBe(true);
  });
  it('protects prepopulated editors on late injection', () => {
    expect(install('<input value="An existing draft">', true).status().dirty).toBe(true);
  });
  it('does not clear protection just because an SPA submits or removes an editor', () => {
    const instance = install('<form><input></form>');
    const input = document.querySelector('input')!; input.value = 'draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    input.remove(); expect(instance.status().dirty).toBe(true);
  });
  it('clears only reset controls after a successful reset', async () => {
    vi.useFakeTimers(); const instance = install('<form><input></form>');
    const input = document.querySelector('input')!; input.value = 'draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form')!.reset(); await vi.advanceTimersByTimeAsync(1);
    expect(instance.status().dirty).toBe(false);
  });
  it('honors cancelled resets', async () => {
    vi.useFakeTimers(); const instance = install('<form><input></form>');
    const form = document.querySelector('form')!; const input = document.querySelector('input')!;
    input.value = 'draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
    form.addEventListener('reset', (event) => event.preventDefault()); form.reset(); await vi.advanceTimersByTimeAsync(1);
    expect(instance.status().dirty).toBe(true);
  });
});
describe('visible sensitive phrases', () => {
  it('reports configured IDs and preserves the match after the warning disappears', () => {
    const instance = install('<p>Save your Seed phrase: synthetic private recovery words</p>');
    expect(instance.status().phraseIds).toContain('crypto-2');
    expect(JSON.stringify(instance.status())).not.toContain('synthetic private');
    document.body.innerHTML = '<p>Dashboard</p>';
    expect(instance.status().phraseIds).toContain('crypto-2');
  });
  it('does not attribute a previous match to edited wording', () => {
    const settings = defaultSettings(); settings.phrases = [{ id: 'mine', text: 'My personal warning', enabled: true, recommended: false }];
    const instance = install('<p>My personal warning</p>'); instance.configure(settings);
    expect(instance.status().phraseIds).toEqual(['mine']);
    settings.phrases[0]!.text = 'Different wording'; instance.configure(settings);
    expect(instance.status().phrase).toBe(true);
    expect(instance.status().phraseIds).toBeUndefined();
  });
  it('matches casing, whitespace, crypto terms and text split across elements', () => {
    expect(install('<p>This is ONLY <strong>SHOWN</strong>\nONCE.</p>').status().phrase).toBe(true);
    guard?.dispose();
    expect(install('<p>Save your SEED PHRASE</p>').status().phrase).toBe(true);
  });
  it('ignores scripts, styles and hidden warnings', () => {
    const instance = install('<script>Seed phrase</script><p hidden>Seed phrase</p><p style="display:none">Only shown once</p><textarea>Seed phrase</textarea><p>Ordinary wallet balance</p>');
    expect(instance.status().phrase).toBe(false);
  });
  it('detects dynamic dialogs and keeps protection after dismissal', async () => {
    vi.useFakeTimers(); const instance = install('<main>Dashboard</main>');
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Copy this key now</div>');
    await vi.advanceTimersByTimeAsync(400);
    expect(instance.status().phrase).toBe(true);
    document.querySelector('[role="dialog"]')!.remove();
    expect(instance.status().phrase).toBe(true);
  });
  it('honors disabled phrases and the guard toggle', () => {
    const instance = install('<p>My personal warning</p>'); const settings = defaultSettings();
    settings.phrases = [{ id: 'mine', text: 'My personal warning', enabled: false, recommended: false }];
    instance.configure(settings); expect(instance.status().phrase).toBe(false);
    settings.phrases[0]!.enabled = true; instance.configure(settings); expect(instance.status().phrase).toBe(true);
  });
  it('treats an incomplete scan as unsafe', () => {
    const instance = install(`<p>${'x'.repeat(260000)}</p>`);
    expect(instance.status().complete).toBe(false);
  });
});
describe.each([{ kind: 'idle' }, { kind: 'collapse', groupId: 2 }] as DiscardTrigger[])('$kind form integration', (trigger) => {
  it('connects real form detection to the discard decision', async () => {
    const instance = install('<input>');
    const deps: EngineDependencies = {
      getTab: async () => ({ id: 1, url: 'https://example.com/', active: false, pinned: false, discarded: false, groupId: 2, windowId: 1 }),
      getSettings: defaultSettings, getIdleSince: () => 0, now: () => 600000,
      isManual: () => false, groupCollapsed: async () => true,
      checkGuards: async () => [instance.status()], discard: vi.fn(), documentVersion: () => 0,
    };
    // Maintain a stable config reference, as the worker does.
    const settings = defaultSettings(); deps.getSettings = () => settings;
    const input = document.querySelector('input')!; input.value = 'unsaved secret'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(await createDiscardEngine(deps).tryDiscard(1, trigger)).toBe('form');
    expect(deps.discard).not.toHaveBeenCalled();
  });
});
